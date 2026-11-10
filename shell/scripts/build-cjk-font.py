#!/usr/bin/env python3
"""
构建「全量常用汉字」字体 —— 一次下载、一劳永逸。

为什么需要它：

引擎画文本节点时只认节点自己的 `fontFamily`，**不走 CJK fallback 列表**。
而 Google Fonts 的 `text=` 精确子集只含我们指定的那几个字，于是 agent 写的新字
不在子集里 → 字形缺失 → 节点在、图层树里有、**画布上完全不显示**。

补子集这条路走不通：Skia 的 `TypefaceFontProvider` 一个族只认一个 typeface，
同族重复注册**不覆盖**（`std::map::emplace` 不替换已存在的 key），
后取的子集永远排在旧的后面、用不上。

所以在**构建期**把常用字（GB2312 一级字表 3755 字 + ASCII）合成一个完整字体，
运行时本地注册一次，所有常用字一次到位、零网络。

流程：
  1. 用旧 Safari 的 UA 请求 Google —— 它给的是 **woff**（不是 woff2），
     fontTools 能直接读（woff 只需 zlib，不需要 brotli）。
  2. `fontTools subset` 裁到常用字集合，输出 OTF（Skia 原生支持 CFF/OTF）。

用法：python3 scripts/build-cjk-font.py
"""
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'public', 'OpenDesignerSC.otf')

# 旧 Safari 的 UA —— Google 会回 woff（zlib 压缩的 sfnt），不是 woff2
LEGACY_UA = (
    'Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; en-us) '
    'AppleWebKit/534.50 (KHTML, like Gecko) Version/5.1 Safari/534.50'
)
CSS_URL = 'https://fonts.googleapis.com/css?family=Noto+Sans+SC:400&subset=chinese-simplified'


def gb2312_level1() -> str:
    """GB2312 一级汉字（3755 个，按拼音排序）—— 日常中文里 99.5% 都在里头。"""
    chars = []
    for hi in range(0xB0, 0xD8):
        for lo in range(0xA1, 0xFF):
            try:
                chars.append(bytes([hi, lo]).decode('gb2312'))
            except Exception:
                pass
    return ''.join(chars)


def main() -> int:
    import re

    request = urllib.request.Request(CSS_URL, headers={'User-Agent': LEGACY_UA})
    with urllib.request.urlopen(request, timeout=60) as response:
        css = response.read().decode('utf-8')
    match = re.search(r'src:\s*url\((https:[^)]+)\)', css)
    if not match:
        print('拿不到字体 URL', file=sys.stderr)
        return 1

    tmp = os.path.join(HERE, '..', '.cjk-src.woff')
    request = urllib.request.Request(match.group(1), headers={'User-Agent': LEGACY_UA})
    with urllib.request.urlopen(request, timeout=180) as response:
        data = response.read()
    with open(tmp, 'wb') as handle:
        handle.write(data)
    print(f'下载 {len(data) / 1024:.0f} KB')

    from fontTools import subset

    text = gb2312_level1() + ''.join(chr(c) for c in range(32, 127))
    options = subset.Options()
    options.layout_features = ['*']
    options.name_IDs = ['*']
    options.notdef_outline = True
    options.recalc_bounds = True
    options.drop_tables += ['DSIG']
    font = subset.load_font(tmp, options)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=text)
    subsetter.subset(font)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    subset.save_font(font, OUT, options)
    os.remove(tmp)

    size = os.path.getsize(OUT)
    print(f'输出 {OUT} —— {size / 1024:.0f} KB（{len(text)} 个字符）')
    return 0


if __name__ == '__main__':
    sys.exit(main())
