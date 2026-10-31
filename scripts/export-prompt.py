#!/usr/bin/env python3
"""从 HANDOFF.md 里抽出「启动 prompt」代码块，导出成独立 txt。

用法：python3 scripts/export-prompt.py > START_PROMPT.txt
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
handoff = (ROOT / "HANDOFF.md").read_text(encoding="utf-8")

# HANDOFF.md 里启动 prompt 用 ```` 四个反引号包裹（内层还有 ``` 代码块）
m = re.search(r"## 启动 prompt（复制即用）\s*\n+````\n(.*?)\n````", handoff, re.S)
if not m:
    sys.exit("没找到启动 prompt 代码块，HANDOFF.md 结构变了？")

prompt = m.group(1)

header = (
    "# OpenDesigner Phase 0 核对 —— 启动 prompt\n"
    "#\n"
    "# 用法：把下面「=== PROMPT BEGIN ===」和「=== PROMPT END ===」之间的内容\n"
    "# 整段复制给云电脑上的执行 AI。它会自己 clone 仓库并开始干活。\n"
    "#\n"
    "# 本文件由 scripts/export-prompt.py 从 HANDOFF.md 自动生成，改完 HANDOFF.md\n"
    "# 请重新跑一次脚本，别手改这里。\n"
    "\n"
    "=== PROMPT BEGIN ===\n"
)

sys.stdout.write(header + prompt + "\n=== PROMPT END ===\n")
sys.stderr.write(f"exported {len(prompt)} chars\n")
