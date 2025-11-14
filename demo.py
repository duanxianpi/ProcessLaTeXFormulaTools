# -*- encoding: utf-8 -*-
# @Author: SWHL
# @Contact: liekkaskono@163.com
from process_formula import NormalizeFormula

normlizer = NormalizeFormula()

math_str = [
    r"""\begin{table}
\begin{tabular}{c c c c} \hline \hline \(n_{f}\) & \(n_{c}\) & abs. error \(E_{n_{f}}^{\llcorner}\) & EOC\({}^{\llcorner}\) \\ \hline
6 & 18 & \(7.0712_{-3}\) & \\
12 & 36 & \(3.1014_{-3}\) & \(1.1891\) \\
24 & 72 & \(1.1976_{-3}\) & \(1.3728\) \\
48 & 144 & \(4.7500_{-4}\) & \(1.3341\) \\
96 & 288 & \(1.8860_{-4}\) & \(1.3326\) \\
192 & 576 & \(7.4872_{-5}\) & \(1.3329\) \\
384 & 1152 & \(2.9724_{-5}\) & \(1.3327\) \\ \hline \hline \end{tabular}
\end{table}""",
]

result = normlizer(math_str)
print(result)
