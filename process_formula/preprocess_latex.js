const katex = require("./third_party/katex/dist/katex.js");
const readline = require("readline");

const ParseError = katex.ParseError || Error;

class NormalizationOptions {
	constructor(font = null) {
		this.font = font;
	}

	withFont(font) {
		return new NormalizationOptions(font);
	}
}

let normStr = "";

const INPUT_SEPARATOR = process.env.PROCESS_LATEX_SEPARATOR || "<=<=<=E=N=D=>=>=>";

const rl = readline.createInterface({
	input: process.stdin,
	output: process.stdout,
	terminal: false,
});

let pendingLines = [];

rl.on("line", (rawLine = "") => {
	if (rawLine === INPUT_SEPARATOR) {
		flushPendingBuffer();
		return;
	}
	pendingLines.push(rawLine);
});

rl.on("close", () => {
	flushPendingBuffer();
});

function flushPendingBuffer() {
	if (!pendingLines.length) {
		return;
	}
	const rawInput = pendingLines.join("\n");
	pendingLines = [];
	handleInputChunk(rawInput);
}

function handleInputChunk(rawInput = "") {
	const preprocessed = preprocessLine(rawInput);
	if (!preprocessed.trim()) {
		console.log("");
		return;
	}
	const sanitizedLine = stripFormulaWrappers(stripLabel(preprocessed));
	try {
		if (process.argv[2] === "tokenize") {
			katex.__parse(sanitizedLine, {});
			const tokens = tokenizeLatex(sanitizedLine);
			console.log(JSON.stringify(formatTokensForHF(tokens, sanitizedLine)));
		} else {
			const converted = convertRmToMathrm(sanitizedLine);
			const tree = katex.__parse(converted, {});
			normStr = "";
			buildExpression(tree, new NormalizationOptions());
			let normalized = normStr;
			for (let i = 0; i < 300; ++i) {
				normalized = normalized.replace(/SSSSSS/g, "$")
					.replace(/ S S S S S S/g, "$");
			}
			console.log(stripLabel(normalized));
		}
	} catch (error) {
		console.error(sanitizedLine);
		console.error(normStr);
		console.error(error);
		console.log("");
	}
	normStr = "";
}

function stripLabel(content) {
	return content.replace(/\\label\s*{.*?}/g, "");
}

// Strip \[ \] 
function stripFormulaWrappers(formula) {
	return formula.replace(/^\\\[\s*/, "").replace(/\s*\\\]$/, "");
}

function preprocessLine(input) {
	const segments = String(input).split(/\r?\n/);
	return segments.map(sanitizeSingleLine).join("\n");
}

function sanitizeSingleLine(inputLine = "") {
	let line = String(inputLine);
	if (!line.length) {
		return "";
	}
	if (line[0] === "%") {
		line = line.substring(1);
	}
	line = line.split("%")[0];

	line = line.split("\\~").join(" ");

	for (let i = 0; i < 300; i++) {
		line = line.replace(/\\>/, " ");
		line = line.replace(/\$/g, " ");
		line = line.replace(/\\label{.*?}/, "");
	}

	if (line.indexOf("matrix") === -1 && line.indexOf("cases") === -1 &&
		line.indexOf("array") === -1 && line.indexOf("begin") === -1) {
		for (let i = 0; i < 300; i++) {
			line = line.replace(/\\\\/, "\\,");
		}
	}

	return `${line} `;
}

const TEXT_MODE_COMMANDS = new Set([
	"\\hbox",
	"\\mbox",
	"\\text",
	"\\textnormal",
	"\\textrm",
]);

function convertRmToMathrm(line) {
	if (!line) {
		return "";
	}
	let result = "";
	const contextStack = [];
	let pendingTextMode = null;
	let i = 0;
	const isLetter = (ch) => /[A-Za-z]/.test(ch);
	const currentTextMode = () => (contextStack.length ? contextStack[contextStack.length - 1] : false);

	while (i < line.length) {
		const ch = line[i];
		if (ch === "{") {
			const inherited = currentTextMode();
			const nextMode = pendingTextMode == null ? inherited : pendingTextMode;
			contextStack.push(nextMode);
			pendingTextMode = null;
			result += ch;
			i += 1;
			continue;
		}
		if (ch === "}") {
			if (contextStack.length) {
				contextStack.pop();
			}
			pendingTextMode = null;
			result += ch;
			i += 1;
			continue;
		}
		if (ch === "\\") {
			let j = i + 1;
			if (j >= line.length) {
				result += "\\";
				break;
			}
			if (isLetter(line[j])) {
				while (j < line.length && isLetter(line[j])) {
					j += 1;
				}
				const command = `\\${line.slice(i + 1, j)}`;
				if (command === "\\rm") {
					result += currentTextMode() ? "\\rm" : "\\mathrm";
					pendingTextMode = null;
				} else {
					result += command;
					pendingTextMode = TEXT_MODE_COMMANDS.has(command) ? true : null;
				}
				i = j;
				continue;
			}
			const nextIndex = Math.min(i + 2, line.length);
			result += line.slice(i, nextIndex);
			pendingTextMode = null;
			i = nextIndex;
			continue;
		}
		result += ch;
		pendingTextMode = null;
		i += 1;
	}
	return result;
}

const spaceRegexString = "[ \\r\\n\\t]";
const controlWordRegexString = "\\\\[a-zA-Z@]+";
const controlSymbolRegexString = "\\\\[^\\uD800-\\uDFFF]";
const controlWordWhitespaceRegexString =
	`(${controlWordRegexString})${spaceRegexString}*`;
const controlSpaceRegexString = "\\\\(\\n|[ \\r\\t]+\\n?)[ \\r\\t]*";
const combiningDiacriticalMarkString = "[\\u0300-\\u036f]";
const tokenRegexString = `(${spaceRegexString}+)|` +
	`${controlSpaceRegexString}|` +
	"([!-\\[\\]-\\u2027\\u202A-\\uD7FF\\uF900-\\uFFFF]" +
	`${combiningDiacriticalMarkString}*` +
	"|[\\uD800-\\uDBFF][\\uDC00-\\uDFFF]" +
	`${combiningDiacriticalMarkString}*` +
	"|\\\\verb\\*([^]).*?\\4" +
	"|\\\\verb([^*a-zA-Z]).*?\\5" +
	`|${controlWordWhitespaceRegexString}` +
	`|${controlSymbolRegexString})`;

class SimpleLexer {
	constructor(input) {
		this.input = input;
		this.position = 0;
		this.regex = new RegExp(tokenRegexString, "gy");
		this.catcodes = { "%": 14, "~": 13 };
	}

	lex() {
		const input = this.input;
		if (this.position >= input.length) {
			return { text: "EOF", start: this.position, end: this.position };
		}
		const startIndex = this.position;
		this.regex.lastIndex = this.position;
		const match = this.regex.exec(input);
		if (!match) {
			const text = input[this.position];
			this.position += 1;
			return { text, start: startIndex, end: this.position };
		}
		if (match.index !== this.position) {
			const text = input[this.position];
			this.position += 1;
			return { text, start: startIndex, end: this.position };
		}
		this.position = this.regex.lastIndex;
		const endIndex = this.position;
		let text = match[6] || match[3] || (match[2] ? "\\ " : " ");
		if (this.catcodes[text] === 14) {
			const newlineIndex = input.indexOf("\n", this.position);
			if (newlineIndex === -1) {
				this.position = input.length;
			} else {
				this.position = newlineIndex + 1;
			}
			return this.lex();
		}
		return { text, start: startIndex, end: endIndex };
	}
}

function tokenizeLatex(line) {
	const lexer = new SimpleLexer(line);
	const tokens = [];
	while (true) {
		const token = lexer.lex();
		if (!token || token.text === "EOF") {
			break;
		}
		if (token.text && token.text.trim().length > 0) {
			tokens.push({
				text: token.text,
				start: token.start,
				end: token.end,
			});
		}
	}
	return tokens;
}

const sizeFunctions = [
	"\\tiny", "\\sixptsize", "\\scriptsize", "\\footnotesize", "\\small",
	"\\normalsize", "\\large", "\\Large", "\\LARGE", "\\huge", "\\Huge",
];

const styleCommands = {
	display: "\\displaystyle",
	text: "\\textstyle",
	script: "\\scriptstyle",
	scriptscript: "\\scriptscriptstyle",
};

const delimiterMap = {
	mopen: { 1: "\\bigl", 2: "\\Bigl", 3: "\\biggl", 4: "\\Biggl" },
	mclose: { 1: "\\bigr", 2: "\\Bigr", 3: "\\biggr", 4: "\\Biggr" },
	mrel: { 1: "\\bigm", 2: "\\Bigm", 3: "\\biggm", 4: "\\Biggm" },
	mord: { 1: "\\big", 2: "\\Big", 3: "\\bigg", 4: "\\Bigg" },
};

const MATRIX_DELIMITER_MAP = {
	pmatrix: {left: "(", right: ")"},
	bmatrix: {left: "[", right: "]"},
	Bmatrix: {left: "\\{", right: "\\}"},
	vmatrix: {left: "|", right: "|"},
	Vmatrix: {left: "\\Vert", right: "\\Vert"},
};

const groupHandlers = {
	mathord: (group, options) => appendText(group.text, options),
	textord: (group) => appendRaw(group.text),
	atom: (group) => appendRaw(group.text),
	spacing: (group) => appendRaw(group.text),
	ordgroup: (group, options) => {
		if (isImplicitOrdGroup(group)) {
			buildExpression(group.body, options);
			return;
		}
		normStr += "{ ";
		buildExpression(group.body, options);
		normStr += "} ";
	},
	text: (group, options) => {
		normStr += "\\mathrm { ";
		buildExpression(group.body, options.withFont("mathrm"));
		normStr += "} ";
	},
	color: (group, options) => {
		normStr += `\\color { ${group.color} } `;
		buildExpression(group.body, options);
	},
	supsub: (group, options) => {
		buildGroup(group.base, options);
		if (group.sub) {
			normStr += "_ ";
			wrapIfNeeded(group.sub, options);
		}
		if (group.sup) {
			normStr += "^ ";
			wrapIfNeeded(group.sup, options);
		}
	},
	genfrac: (group, options) => {
		normStr += group.hasBarLine ? "\\frac " : "\\binom ";
		wrapIfNeeded(group.numer, options);
		wrapIfNeeded(group.denom, options);
	},
	array: (group, options) => {
		if (isSmallMatrixArray(group)) {
			renderMatrixEnvironment(group, "smallmatrix", options);
			return;
		}
		const matrixMatch = detectBareMatrix(group);
		if (matrixMatch) {
			renderMatrixEnvironment(matrixMatch.arrayNode, matrixMatch.envName, options, matrixMatch.optionalAlign);
			return;
		}
		renderArray(group, options, "array");
	},
	sqrt: (group, options) => {
		if (group.index) {
			normStr += "\\sqrt [ ";
			buildGroup(group.index, options);
			normStr += "] ";
		} else {
			normStr += "\\sqrt ";
		}
		wrapIfNeeded(group.body, options);
	},
	leftright: (group, options) => {
		const matrixMatch = detectDelimitedMatrix(group);
		if (matrixMatch) {
			renderMatrixEnvironment(matrixMatch.arrayNode, matrixMatch.envName, options, matrixMatch.optionalAlign);
			return;
		}
		normStr += `\\left${group.left} `;
		buildExpression(group.body, options);
		normStr += `\\right${group.right} `;
	},
	accent: (group, options) => {
		normStr += `${group.label} `;
		wrapIfNeeded(group.base, options);
	},
	accentUnder: (group, options) => {
		normStr += `${group.label} `;
		wrapIfNeeded(group.base, options);
	},
	font: (group, options) => {
		const normalizedFont = group.font === "mbox" || group.font === "hbox"
			? "mathrm"
			: group.font;
		if (group.mode === "text" && normalizedFont === "mathrm") {
			normStr += "\\rm ";
			wrapIfNeeded(group.body, options.withFont("mathrm"));
			return;
		}
		normStr += `\\${normalizedFont} `;
		wrapIfNeeded(group.body, options.withFont(normalizedFont));
	},
	hbox: (group, options) => {
		normStr += "\\hbox { ";
		if (Array.isArray(group.body)) {
			buildExpression(group.body, options);
		}
		normStr += "} ";
	},
	delimsizing: (group) => {
		const command = delimiterMap[group.mclass] && delimiterMap[group.mclass][group.size];
		const func = command || "\\big";
		normStr += `${func} ${group.delim} `;
	},
	styling: (group, options) => {
		const command = styleCommands[group.style] || "";
		if (command) {
			normStr += `${command} `;
		}
		buildExpression(group.body, options);
	},
	sizing: (group, options) => {
		const command = sizeFunctions[group.size - 1];
		if (command) {
			normStr += `${command} `;
		}
		buildExpression(group.body, options);
	},
	overline: (group, options) => {
		normStr += "\\overline { ";
		buildGroup(group.body, options);
		normStr += "} ";
	},
	underline: (group, options) => {
		normStr += "\\underline { ";
		buildGroup(group.body, options);
		normStr += "} ";
	},
	rule: (group) => {
		normStr += `\\rule { ${measurementToString(group.width)} } { ${measurementToString(group.height)} } `;
	},
	lap: (group, options) => {
		normStr += `\\${group.alignment || "lap"} `;
		buildGroup(group.body, options);
	},
	llap: (group, options) => {
		normStr += "\\llap ";
		wrapIfNeeded(group.body, options);
	},
	rlap: (group, options) => {
		normStr += "\\rlap ";
		wrapIfNeeded(group.body, options);
	},
	phantom: (group, options) => {
		normStr += "\\phantom { ";
		buildExpression(group.body, options);
		normStr += "} ";
	},
	pmb: (group, options) => {
		normStr += "\\pmb { ";
		buildExpression(group.body, options);
		normStr += "} ";
	},
	op: (group, options) => {
		if (group.symbol) {
			normStr += `${group.name} `;
		} else {
			normStr += group.limits === false ? "\\operatorname { " : "\\operatorname* { ";
			buildExpression(group.body, options);
			normStr += "} ";
		}
	},
	operatorname: (group, options) => {
		normStr += group.alwaysHandleSupSub ? "\\operatorname* { " : "\\operatorname { ";
		buildExpression(group.body, options);
		normStr += "} ";
	},
	mclass: (group, options) => {
		if (renderStacklikeOperator(group, options)) {
			return;
		}
		buildExpression(group.body, options);
	},
	mathchoice: (group, options) => buildExpression(group.display, options),
	htmlmathml: (group, options) => buildExpression(group.mathml || group.html, options),
	href: (group, options) => {
		normStr += `\\href { ${group.href} } { `;
		buildExpression(group.body, options);
		normStr += "} ";
	},
	html: (group, options) => buildExpression(group.body, options),
	tag: (group, options) => {
		normStr += "\\tag { ";
		buildExpression(group.tag, options);
		normStr += "} ";
		buildExpression(group.body, options);
	},
	url: (group) => {
		normStr += `\\url { ${group.url} } `;
	},
	raw: (group) => appendRaw(group.string),
	verb: (group) => {
		const command = group.star ? "\\verb*" : "\\verb";
		normStr += `${command}|${group.body}| `;
	},
	kern: (group) => {
		const macro = mapKernToMacro(group.dimension);
		if (macro) {
			normStr += `${macro} `;
		} else {
			normStr += `\\kern { ${measurementToString(group.dimension)} } `;
		}
	},
	raisebox: (group, options) => {
		normStr += `\\raisebox { ${measurementToString(group.dy)} } { `;
		buildGroup(group.body, options);
		normStr += "} ";
	},
	smash: (group, options) => {
		normStr += "\\smash { ";
		buildGroup(group.body, options);
		normStr += "} ";
	},
	vcenter: (group, options) => {
		normStr += "\\vcenter { ";
		buildGroup(group.body, options);
		normStr += "} ";
	},
	xArrow: (group, options) => {
		normStr += `${group.label} `;
		buildGroup(group.body, options);
		if (group.below) {
			wrapIfNeeded(group.below, options);
		}
	},
	cr: () => {
		normStr += "\\\\ ";
	},
};

function appendRaw(text) {
	if (typeof text === "string" && text.length > 0) {
		normStr += `${text} `;
	}
}

function appendText(text, options) {
	if (typeof text !== "string") {
		return;
	}
	if (options.font === "mathrm") {
		for (const ch of text) {
			if (ch === " ") {
				normStr += " \; ";
			} else {
				normStr += `${ch} `;
			}
		}
	} else {
		normStr += `${text} `;
	}
}

function wrapIfNeeded(node, options) {
	if (!node) {
		return;
	}
	if (node.type === "ordgroup") {
		buildGroup(node, options);
	} else {
		normStr += "{ ";
		buildGroup(node, options);
		normStr += "} ";
	}
}

function isSmallMatrixArray(group) {
	return Boolean(group && group.type === "array" && group.colSeparationType === "small");
}

function detectBareMatrix(group) {
	if (!isMatrixArrayNode(group)) {
		return null;
	}
	const info = buildMatrixMetadata(group, "matrix");
	return info;
}

function detectDelimitedMatrix(group) {
	if (!Array.isArray(group.body) || group.body.length !== 1) {
		return null;
	}
	const inner = group.body[0];
	if (!isMatrixArrayNode(inner)) {
		return null;
	}
	for (const [baseEnv, delims] of Object.entries(MATRIX_DELIMITER_MAP)) {
		if (group.left === delims.left && group.right === delims.right) {
			return buildMatrixMetadata(inner, baseEnv);
		}
	}
	return null;
}

function buildMatrixMetadata(arrayNode, baseEnv) {
	if (!arrayNode) {
		return null;
	}
	const alignChar = inferMatrixAlign(arrayNode);
	const needsStar = alignChar && alignChar !== "c";
	return {
		arrayNode,
		envName: needsStar ? `${baseEnv}*` : baseEnv,
		optionalAlign: needsStar ? alignChar : null,
	};
}

function isMatrixArrayNode(arrayNode) {
	if (!arrayNode || arrayNode.type !== "array") {
		return false;
	}
	if (arrayNode.colSeparationType && arrayNode.colSeparationType !== "small") {
		return false;
	}
	if (arrayNode.hskipBeforeAndAfter !== false) {
		return false;
	}
	if (!Array.isArray(arrayNode.cols) || arrayNode.cols.length === 0) {
		return false;
	}
	return arrayNode.cols.every((col) => col && col.type === "align" && typeof col.align === "string" && col.pregap == null && col.postgap == null);
}

function inferMatrixAlign(arrayNode) {
	if (!Array.isArray(arrayNode.cols) || arrayNode.cols.length === 0) {
		return "c";
	}
	const alignEntry = arrayNode.cols.find((col) => col && col.align);
	return alignEntry ? String(alignEntry.align).toLowerCase() : "c";
}

function renderMatrixEnvironment(arrayNode, envName, options, optionalAlign) {
	normStr += `\\begin{${envName}} `;
	if (optionalAlign) {
		normStr += `[${optionalAlign}] `;
	}
	appendArrayRows(arrayNode, options);
	normStr += `\\end{${envName}} `;
}

function appendArrayRows(group, options) {
	const bodyRows = group.body || [];
	bodyRows.forEach((row, rowIndex) => {
		if (!row || row.length === 0) {
			return;
		}
		if (group.hLinesBeforeRow && group.hLinesBeforeRow[rowIndex] && group.hLinesBeforeRow[rowIndex].length) {
			normStr += "\\hline ";
		}
		row.forEach((cell, cellIndex) => {
				buildArrayCell(cell, options);
			if (cellIndex < row.length - 1) {
				normStr += "& ";
			}
		});
		normStr += "\\\\ ";
	});

	if (group.hLinesBeforeRow &&
		group.hLinesBeforeRow[bodyRows.length] &&
		group.hLinesBeforeRow[bodyRows.length].length) {
		normStr += "\\hline ";
	}
}

function isImplicitOrdGroup(group) {
	if (!group || group.type !== "ordgroup" || !Array.isArray(group.body)) {
		return false;
	}
	if (!group.loc) {
		return true;
	}
	if (group.body.length !== 1) {
		return false;
	}
	const child = group.body[0];
	if (!child || !child.loc) {
		return false;
	}
	return group.loc.start === child.loc.start && group.loc.end === child.loc.end;
}

function buildArrayCell(cell, options) {
	if (!cell) {
		return;
	}
	if (tryRenderWithoutAutoStyling(cell, options)) {
		return;
	}
	buildGroup(cell, options);
}

function tryRenderWithoutAutoStyling(cell, options) {
	if (!cell || cell.type !== "styling" || !Array.isArray(cell.body) || cell.body.length !== 1) {
		return false;
	}
	const child = cell.body[0];
	if (!child || child.type !== "ordgroup" || !isImplicitOrdGroup(child)) {
		return false;
	}
	buildExpression(child.body, options);
	return true;
}

function renderArray(group, options, envName) {
	const cols = group.cols || [];
	normStr += `\\begin{${envName}} `;
	normStr += "{ ";
	if (cols.length > 0) {
		cols.forEach(col => {
			if (!col) {
				return;
			}
			if (col.type === "align") {
				normStr += `${col.align} `;
			} else if (col.type === "separator") {
				normStr += `${col.separator} `;
			}
		});
	} else if (group.body && group.body[0]) {
		for (let i = 0; i < group.body[0].length; i++) {
			normStr += "c ";
		}
	}
	normStr += "} ";
	appendArrayRows(group, options);
	normStr += `\\end{${envName}} `;
}

function renderStacklikeOperator(group, options) {
	if (!group || group.type !== "mclass" || !Array.isArray(group.body) || group.body.length !== 1) {
		return false;
	}
	const container = group.body[0];
	if (!container || container.type !== "supsub") {
		return false;
	}
	const baseOp = container.base;
	if (!baseOp || baseOp.type !== "op" || baseOp.symbol || !baseOp.limits ||
		!Array.isArray(baseOp.body) || baseOp.body.length === 0) {
		return false;
	}
	const hasSup = Boolean(container.sup);
	const hasSub = Boolean(container.sub);
	let command = null;
	if (hasSup && !hasSub) {
		command = baseOp.suppressBaseShift ? "\\overset" : "\\stackrel";
	} else if (!hasSup && hasSub) {
		command = "\\underset";
	} else {
		return false;
	}
	normStr += `${command} `;
	const shiftedNode = hasSup ? container.sup : container.sub;
	appendStacklikeArgument(shiftedNode, options);
	appendStacklikeBody(baseOp.body, options);
	return true;
}

function appendStacklikeArgument(node, options) {
	normStr += "{ ";
	if (node) {
		if (node.type === "ordgroup" && Array.isArray(node.body)) {
			buildExpression(node.body, options);
		} else {
			buildGroup(node, options);
		}
	}
	normStr += "} ";
}

function appendStacklikeBody(bodyNodes, options) {
	normStr += "{ ";
	if (Array.isArray(bodyNodes)) {
		buildExpression(bodyNodes, options);
	}
	normStr += "} ";
}

function measurementToString(measurement = {}) {
	if (measurement.number == null) {
		return "0";
	}
	return `${measurement.number} ${measurement.unit || "em"}`;
}

function formatTokensForHF(tokenEntries = [], sourceLine = "") {
	const trimmedSource = sourceLine.trim();
	return {
		text: trimmedSource,
		length: tokenEntries.length,
		tokens: tokenEntries.map((entry) => entry.text),
		offsets: tokenEntries.map((entry) => [entry.start ?? -1, entry.end ?? -1]),
	};
}

const KERN_MACRO_TABLE = [
	{unit: "mu", value: -3, macro: "\\!"},
	{unit: "mu", value: 3, macro: "\\,"},
	{unit: "mu", value: 4, macro: "\\:"},
	{unit: "mu", value: 5, macro: "\\;"},
	{unit: "em", value: 0.5, macro: "\\enspace"},
	{unit: "em", value: 1, macro: "\\quad"},
	{unit: "em", value: 2, macro: "\\qquad"},
];

function mapKernToMacro(dimension = {}) {
	if (typeof dimension.number !== "number" || !dimension.unit) {
		return null;
	}
	for (const entry of KERN_MACRO_TABLE) {
		if (entry.unit === dimension.unit &&
			Math.abs(dimension.number - entry.value) < 1e-6) {
			return entry.macro;
		}
	}
	return null;
}

function buildExpression(expression, options) {
	if (!expression || !expression.length) {
		return;
	}
	for (let i = 0; i < expression.length; i++) {
		buildGroup(expression[i], options);
	}
}

function buildGroup(group, options) {
	if (!group) {
		return;
	}
	const handler = groupHandlers[group.type];
	if (handler) {
		handler(group, options);
	} else if (Array.isArray(group.body)) {
		buildExpression(group.body, options);
	} else if (typeof group.text === "string") {
		appendRaw(group.text);
	} else {
		throw new ParseError(`Unknown group type: ${group.type}`);
	}
}

