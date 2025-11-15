# -*- encoding: utf-8 -*-
# @Author: SWHL
# @Contact: liekkaskono@163.com
from process_formula import NormalizeFormula

normlizer = NormalizeFormula()

math_str = [
    r"""\[\stackrel{A}{B}\]""",
]

result = normlizer(math_str)
print(result)
