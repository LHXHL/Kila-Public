#!/usr/bin/env python3
"""将 WeWrite 生成的 Kila 公众号 HTML 调整为 Kami 风格的可复制预览页。"""

from __future__ import annotations

import sys
from pathlib import Path

from bs4 import BeautifulSoup, Tag

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "kila-ai-workbench-kami-wechat.raw.html"
OUTPUT = ROOT / "kila-ai-workbench-kami-wechat.html"

PARCHMENT = "#FFFFFF"
IVORY = "#FFFFFF"
INK = "#141413"
TEXT = "#3D3D3A"
MUTED = "#6B6A64"
BRAND = "#1B365D"
BORDER = "#DFDDD2"
SOFT_BORDER = "#D9D7CE"


def apply_style(element: Tag, style: str) -> None:
    """用完整内联样式覆盖元素，保证复制到微信编辑器后仍保留样式。"""
    element["style"] = style


def contains(style: str, value: str) -> bool:
    return value.lower() in style.lower()


def direct_sections(element: Tag) -> list[Tag]:
    return [child for child in element.find_all("section", recursive=False)]


def restyle_dialogue(element: Tag) -> None:
    style = element.get("style", "")
    # WeWrite 的 :::dialogue 约定中，普通行是用户输入；以 > 开头的行是 Agent 回复。
    # 原始 HTML 将 > 行右对齐；这里按产品语义翻转为「用户右侧、Agent 左侧」。
    is_agent_reply = "justify-content: flex-end" in style
    apply_style(
        element,
        f"display: flex; justify-content: {'flex-start' if is_agent_reply else 'flex-end'}; margin: 10px 0",
    )
    children = direct_sections(element)
    if not children:
        return
    bubble = children[0]
    if is_agent_reply:
        apply_style(
            bubble,
            "background: #FFFFFF; color: #3D3D3A; padding: 11px 14px; border: 1px solid #DFDDD2; "
            "border-radius: 2px; max-width: 86%; font-size: 15px; line-height: 1.75; letter-spacing: 0.2px",
        )
    else:
        apply_style(
            bubble,
            "background: #1B365D; color: #FFFFFF; padding: 11px 14px; border: 1px solid #1B365D; "
            "border-radius: 2px; max-width: 86%; font-size: 15px; line-height: 1.75; letter-spacing: 0.2px",
        )


def restyle_timeline(element: Tag) -> None:
    children = direct_sections(element)
    if len(children) < 2:
        return
    rail, content = children[0], children[1]
    apply_style(rail, "flex-shrink: 0; width: 13px; display: flex; flex-direction: column; align-items: center")
    rail_children = direct_sections(rail)
    if rail_children:
        apply_style(
            rail_children[0],
            "width: 7px; height: 7px; border-radius: 50%; background: #1B365D; margin-top: 8px; border: 2px solid #FFFFFF; "
            "box-shadow: 0 0 0 1px #1B365D",
        )
    if len(rail_children) > 1:
        apply_style(rail_children[1], "width: 1px; flex: 1; background: #D9D7CE; margin-top: 5px")
    apply_style(
        content,
        "flex: 1; padding: 0 0 16px 14px; font-size: 15px; line-height: 1.82; color: #3D3D3A; border-bottom: 1px solid #E8E6DE",
    )


def restyle_steps(element: Tag) -> None:
    apply_style(element, "margin: 22px 0 6px; padding: 16px 0 2px; border-top: 1px solid #D9D7CE")
    for item in direct_sections(element):
        item_children = direct_sections(item)
        if len(item_children) < 2:
            continue
        apply_style(item, "display: flex; margin: 0; padding: 0 0 13px")
        apply_style(
            item_children[0],
            "flex-shrink: 0; width: 22px; height: 22px; border-radius: 50%; background: #FFFFFF; color: #1B365D; "
            "border: 1px solid #1B365D; font-size: 12px; font-weight: 600; text-align: center; line-height: 21px; margin: 2px 11px 0 0",
        )
        apply_style(
            item_children[1],
            "flex: 1; font-size: 15px; line-height: 1.82; color: #3D3D3A; padding-top: 0",
        )


def restyle_callout(element: Tag) -> None:
    style = element.get("style", "")
    if contains(style, "#059669"):
        title = "工作规则"
    elif contains(style, "#d97706"):
        title = "安全边界"
    else:
        title = "表达偏好"
    apply_style(
        element,
        "margin: 20px 0; padding: 15px 17px 16px; background: #FFFFFF; border: 1px solid #DFDDD2; "
        "border-left: 3px solid #1B365D; border-radius: 0; font-size: 15px; line-height: 1.8; color: #3D3D3A",
    )
    children = direct_sections(element)
    if children:
        children[0].clear()
        children[0].append(title)
        apply_style(
            children[0],
            "font-size: 12px; font-weight: 600; color: #1B365D; letter-spacing: 1.2px; line-height: 1.4; margin-bottom: 7px",
        )


def restyle_quote(element: Tag) -> None:
    apply_style(
        element,
        "margin: 28px 0; padding: 18px 19px 18px 20px; background: #FFFFFF; border-top: 1px solid #D9D7CE; "
        "border-bottom: 1px solid #D9D7CE; border-left: 3px solid #1B365D; border-radius: 0",
    )
    children = direct_sections(element)
    if children:
        apply_style(
            children[0],
            "font-family: \"TsangerJinKai02\", \"Source Han Serif SC\", \"Songti SC\", \"STSong\", Georgia, serif; "
            "font-size: 18px; line-height: 1.82; color: #3D3D3A; font-style: normal; letter-spacing: 0.25px",
        )


def restyle_label(element: Tag) -> None:
    apply_style(element, "margin: 44px 0 14px; padding-top: 15px; border-top: 1px solid #D9D7CE")
    span = element.find("span")
    if span:
        apply_style(
            span,
            "display: inline-block; background: transparent; color: #1B365D; font-size: 12px; font-weight: 600; "
            "padding: 0 0 5px; border-radius: 0; border-bottom: 1px solid #1B365D; letter-spacing: 1.2px; line-height: 1.35",
        )


def restyle_summary(element: Tag) -> None:
    apply_style(
        element,
        "margin: 24px 0 30px; padding: 17px 18px 18px; background: #EEF1F2; border: 1px solid #D7DEE5; "
        "border-left: 3px solid #1B365D; border-radius: 0; color: #3D3D3A",
    )
    paragraphs = element.find_all("p", recursive=False)
    if paragraphs:
        apply_style(paragraphs[0], "margin: 0; font-size: 13px; line-height: 1.4; letter-spacing: 1.1px; color: #1B365D")
    if len(paragraphs) > 1:
        apply_style(paragraphs[1], "margin: 9px 0 0; font-size: 16px; line-height: 1.85; color: #3D3D3A")


def restyle_highlight(element: Tag) -> None:
    apply_style(
        element,
        "margin: 25px 0; padding: 18px; background: #F0EFE8; border: 1px solid #DFDDD2; border-radius: 0; "
        "box-shadow: 0 5px 16px rgba(20, 20, 19, 0.035); color: #3D3D3A",
    )
    paragraphs = element.find_all("p", recursive=False)
    for paragraph in paragraphs:
        apply_style(paragraph, "margin: 0; font-size: 16px; line-height: 1.85; color: #3D3D3A")


def restyle_footer(article: Tag) -> None:
    for paragraph in article.find_all("p"):
        if "本文由 AI 辅助创作" in paragraph.get_text():
            apply_style(
                paragraph,
                "text-align: center; font-size: 12px; color: #8A8880; margin: 50px 0 0; padding-top: 19px; "
                "border-top: 1px solid #D9D7CE; line-height: 1.65; letter-spacing: 0.25px",
            )


def classify_and_restyle(article: Tag) -> None:
    """根据 WeWrite 原始容器的结构特征分类，再一次性覆盖样式。"""
    sections = list(article.find_all("section"))

    # 先处理外层容器。必须在任何内层样式被改动之前完成识别。
    for element in sections:
        style = element.get("style", "")
        children = direct_sections(element)
        first_child_style = children[0].get("style", "") if children else ""
        has_pill = bool(element.find("span", style=lambda value: value and "border-radius: 999px" in value))
        is_timeline_item = (
            "display: flex" in style
            and children
            and "width: 12px" in first_child_style
            and "flex-direction: column" in first_child_style
        )
        is_step_wrapper = (
            style.startswith("margin: 20px 0")
            and children
            and "display: flex" in children[0].get("style", "")
            and "width: 22px" in (direct_sections(children[0])[0].get("style", "") if direct_sections(children[0]) else "")
        )

        if "justify-content: flex-" in style:
            restyle_dialogue(element)
        elif is_timeline_item:
            restyle_timeline(element)
        elif is_step_wrapper:
            restyle_steps(element)
        elif "background: linear-gradient" in style:
            restyle_quote(element)
        elif has_pill:
            restyle_label(element)
        elif contains(style, "#EEF1F2"):
            restyle_summary(element)
        elif contains(style, "#F0EFE8"):
            restyle_highlight(element)
        elif "border-left: 4px solid" in style and any(color in style.lower() for color in ("#059669", "#d97706", "#2563eb")):
            restyle_callout(element)


def main() -> None:
    if not SOURCE.exists():
        raise SystemExit(f"缺少 WeWrite 原始输出：{SOURCE}")

    soup = BeautifulSoup(SOURCE.read_text(encoding="utf-8"), "html.parser")
    body = soup.body
    if body is None:
        raise SystemExit("原始 HTML 缺少 body")

    copy_script = body.find("script")
    article = soup.new_tag("section", id="kila-wechat-article")
    apply_style(
        article,
        "box-sizing: border-box; width: 100%; max-width: 720px; margin: 0 auto; padding: 28px 22px 46px; background: #FFFFFF; color: #3D3D3A; "
        "font-family: \"TsangerJinKai02\", \"Source Han Serif SC\", \"Noto Serif CJK SC\", \"Songti SC\", \"STSong\", Georgia, serif",
    )

    for child in list(body.contents):
        if child is copy_script:
            continue
        article.append(child.extract())
    body.clear()
    body.append(article)

    direct_paragraphs = [child for child in article.find_all("p", recursive=False)]
    if direct_paragraphs:
        apply_style(
            direct_paragraphs[0],
            "font-size: 12px; line-height: 1.4; color: #1B365D; margin: 0 0 9px; font-weight: 600; letter-spacing: 1.25px",
        )
    if len(direct_paragraphs) > 1:
        apply_style(
            direct_paragraphs[1],
            "font-size: 16px; line-height: 1.9; color: #504E49; margin: 0 0 18px; letter-spacing: 0.35px",
        )

    classify_and_restyle(article)
    restyle_footer(article)

    preview_style = soup.new_tag("style")
    preview_style.string = """
      /* 预览页与公众号正文分层：页面占满窗口，正文在其中居中。 */
      html, body { box-sizing: border-box; width: 100%; min-width: 0; overflow-x: hidden; }
      body { max-width: none; min-height: 100vh; margin: 0; padding: 0; background: #FFFFFF; }
      #kila-wechat-article { display: block; }
      #kila-wechat-copy { position: fixed; right: 18px; bottom: 18px; z-index: 9999; border: 1px solid #1B365D; border-radius: 2px; padding: 10px 13px; color: #FFFFFF; background: #1B365D; font: 600 13px \"Songti SC\", \"STSong\", Georgia, serif; letter-spacing: .35px; box-shadow: 0 5px 16px rgba(20,20,19,.12); cursor: pointer; }
      #kila-wechat-copy:active { transform: translateY(1px); }
      @media (max-width: 760px) { #kila-wechat-article { box-sizing: border-box !important; width: 100% !important; max-width: 100% !important; padding: 24px 18px 40px !important; } }
    """
    soup.head.append(preview_style)

    script = soup.new_tag("script")
    script.string = """
      (() => {
        const article = document.getElementById('kila-wechat-article');
        const button = document.createElement('button');
        button.id = 'kila-wechat-copy';
        button.type = 'button';
        button.textContent = '复制正文到公众号编辑器';
        button.addEventListener('click', () => {
          try {
            const range = document.createRange();
            range.selectNodeContents(article);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            if (!document.execCommand('copy')) throw new Error('copy failed');
            selection.removeAllRanges();
            button.textContent = '已复制，可直接粘贴';
            window.setTimeout(() => { button.textContent = '复制正文到公众号编辑器'; }, 1800);
          } catch (_) {
            button.textContent = '复制失败，请手动全选正文';
            window.setTimeout(() => { button.textContent = '复制正文到公众号编辑器'; }, 2400);
          }
        });
        document.body.appendChild(button);
      })();
    """
    body.append(script)

    OUTPUT.write_text(str(soup), encoding="utf-8")
    print(f"输出：{OUTPUT}")


if __name__ == "__main__":
    main()
