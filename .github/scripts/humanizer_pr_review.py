#!/usr/bin/env python3
"""Формирует человекочитаемый отзыв редколлегии для pull request."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path

MARKER = "<!-- genealogy-humanizer-review -->"
PUBLIC_TITLE = "Отзыв редколлегии"
CYRILLIC = re.compile(r"[А-Яа-яЁё]")
STYLE_ID = "neutral"
REGISTER = "general"
EVIDENCE_REQUEST = None
MAX_ITEMS_TOTAL = 40
FRONTMATTER_DELIMITER = "---"

EDITORS = (
    ("russian", "📚", "Русский язык", "Замечание по русскому языку"),
    ("native", "💬", "Живой русский", "Замечание по живому русскому"),
    ("chukovsky", "🪶", "Корней Чуковский", "Стилистическое замечание"),
    ("gal", "✒️", "Нора Галь", "Стилистическое замечание"),
    ("ilyakhov", "✂️", "Максим Ильяхов и Людмила Сарычева", "Редакторское замечание"),
    ("visson", "🌍", "Линн Виссон", "Замечание по естественности русской речи"),
    ("rosenthal", "📐", "Д. Э. Розенталь", "Замечание по русскому языку и стилю"),
    ("golub", "🔎", "И. Б. Голуб", "Стилистическое замечание"),
)
EDITOR_INDEX = {editor_id: item for item in EDITORS for editor_id in [item[0]]}

KNOWN_TITLES = {
    "russian.foreign_word_in_russian_prose": "Иностранное слово в русском тексте",
    "russian.unmarked_heading_candidate": "Возможный неразмеченный заголовок",
    "russian.list_case_punctuation_alignment": "Пунктуация в списке",
    "editing.action_hidden_in_nominalization": "Тяжёлая конструкция",
    "native.context_undercompression": "Повтор уже названной информации",
}

KNOWN_REASONS = {
    "editing.action_hidden_in_nominalization": (
        "В предложении несколько существительных, обозначающих действия. "
        "Проверьте, не станет ли фраза легче, если вернуть часть действий в глаголы."
    ),
    "native.context_undercompression": (
        "Соседние предложения повторяют одни и те же смысловые слова. "
        "Проверьте, можно ли сделать повтор компактнее, опираясь на уже сказанное."
    ),
}


def load_humanizer(root: Path):
    scripts = root / "scripts"
    review_path = scripts / "review.py"
    if not review_path.is_file():
        raise RuntimeError(f"Не найден humanizer_russian review.py в {root}")
    sys.path.insert(0, str(scripts))
    spec = importlib.util.spec_from_file_location("humanizer_russian_review", review_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Не удалось загрузить humanizer_russian из {review_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def normalize_excerpt(text: str) -> str:
    return re.sub(r"\s+", " ", str(text).strip()).lower()[:180]


def finding_signature(finding: dict) -> tuple[str, ...]:
    return (
        str(finding.get("library_id") or ""),
        str(finding.get("rule_id") or ""),
        str(finding.get("phenomenon_id") or ""),
        str(finding.get("project_class") or ""),
        str(finding.get("automation_level") or ""),
        str(finding.get("verdict") or ""),
        normalize_excerpt(finding.get("excerpt", "")),
    )


def split_frontmatter(raw: str) -> tuple[str, str, bool]:
    """Возвращает служебный YAML, основной текст и признак наличия YAML-блока."""
    lines = raw.splitlines()
    if not lines or lines[0].strip() != FRONTMATTER_DELIMITER:
        return "", raw, False
    for index in range(1, len(lines)):
        if lines[index].strip() == FRONTMATTER_DELIMITER:
            frontmatter = "\n".join(lines[1:index])
            body = "\n".join(lines[index + 1 :]).lstrip("\n")
            return frontmatter, body, True
    return "", raw, False


def _decode_scalar(value: str) -> str:
    value = value.strip()
    if not value:
        return ""
    if value.startswith('"') and value.endswith('"'):
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value[1:-1]
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    return value


def extract_frontmatter_text(frontmatter: str, key: str) -> str:
    """Извлекает одно текстовое поле верхнего уровня без YAML-зависимости."""
    lines = frontmatter.splitlines()
    pattern = re.compile(rf"^{re.escape(key)}:\s*(.*)$")
    for index, line in enumerate(lines):
        match = pattern.match(line)
        if not match:
            continue
        tail = match.group(1).strip()
        if tail not in {"|", "|-", "|+", ">", ">-", ">+"}:
            return _decode_scalar(tail)

        block: list[str] = []
        for following in lines[index + 1 :]:
            if following and not following[0].isspace():
                break
            if not following.strip():
                block.append("")
                continue
            block.append(following.lstrip())
        if tail.startswith(">"):
            return re.sub(r"\s+", " ", " ".join(block)).strip()
        return "\n".join(block).strip()
    return ""


DEFAULT_VISIBLE_PROPS = frozenset(
    {"title", "label", "caption", "description", "note", "alt", "aria-label"}
)
COMPONENT_VISIBLE_PROPS = {
    "SmartTable": frozenset({"loadingLabel", "emptyLabel"}),
    "Countdown": frozenset({"doneLabel"}),
}

def _mask_span(chars: list[str], start: int, end: int) -> None:
    """Маскирует технический MDX-фрагмент, сохраняя переносы строк."""
    for index in range(start, min(end, len(chars))):
        if chars[index] != "\n":
            chars[index] = " "


def _restore_ranges(
    chars: list[str],
    source: str,
    ranges: list[tuple[int, int]],
) -> int:
    """Возвращает статический читательский текст в уже замаскированный диапазон."""
    restored = 0
    for start, end in ranges:
        if start < 0 or end <= start or start >= len(chars):
            continue
        end = min(end, len(chars))
        chars[start:end] = source[start:end]
        restored += end - start
    return restored


def _scan_braced_expression(text: str, start: int) -> int:
    """Возвращает позицию после сбалансированного MDX/JS-выражения { ... }."""
    depth = 0
    quote_char = ""
    escaped = False
    index = start

    while index < len(text):
        char = text[index]

        if quote_char:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote_char:
                quote_char = ""
            index += 1
            continue

        if text.startswith("//", index):
            newline = text.find("\n", index + 2)
            if newline == -1:
                return len(text)
            index = newline
            continue

        if text.startswith("/*", index):
            closing = text.find("*/", index + 2)
            if closing == -1:
                return start + 1
            index = closing + 2
            continue

        if char in {"'", '"', chr(96)}:
            quote_char = char
        elif char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return index + 1

        index += 1

    return start + 1


def _looks_like_mdx_tag(text: str, start: int) -> bool:
    if text.startswith("<>", start) or text.startswith("</>", start):
        return True
    return bool(
        re.match(
            r"</?[A-Za-z][A-Za-z0-9_.:-]*(?=[\s/>])",
            text[start:],
        )
    )


def _scan_mdx_tag(text: str, start: int) -> int:
    """Возвращает позицию после MDX/JSX-тега, не путаясь в props и строках."""
    quote_char = ""
    escaped = False
    index = start + 1

    while index < len(text):
        char = text[index]

        if quote_char:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote_char:
                quote_char = ""
            index += 1
            continue

        if char in {"'", '"', chr(96)}:
            quote_char = char
            index += 1
            continue

        if char == "{":
            expression_end = _scan_braced_expression(text, index)
            if expression_end > index + 1:
                index = expression_end
                continue

        if char == ">":
            return index + 1

        index += 1

    return start + 1


def _tag_name(text: str, start: int, end: int) -> str:
    match = re.match(r"</?([A-Za-z][A-Za-z0-9_.:-]*)", text[start:end])
    return match.group(1) if match else ""


def _tag_attributes(
    text: str,
    start: int,
    end: int,
) -> list[tuple[str, int | None, int | None, str]]:
    """Разбирает только границы атрибутов; JS внутри выражений не вычисляется."""
    fragment = text[start:end]
    head = re.match(r"</?[A-Za-z][A-Za-z0-9_.:-]*", fragment)
    if head is None or fragment.startswith("</"):
        return []

    result: list[tuple[str, int | None, int | None, str]] = []
    index = start + head.end()

    while index < end:
        while index < end and text[index].isspace():
            index += 1
        if index >= end or text.startswith("/>", index) or text[index] == ">":
            break

        name_match = re.match(r"[A-Za-z_:][A-Za-z0-9_.:-]*", text[index:end])
        if name_match is None:
            index += 1
            continue

        name = name_match.group(0)
        index += len(name)

        while index < end and text[index].isspace():
            index += 1
        if index >= end or text[index] != "=":
            result.append((name, None, None, "boolean"))
            continue

        index += 1
        while index < end and text[index].isspace():
            index += 1
        if index >= end:
            break

        if text[index] in {"'", '"'}:
            quote_char = text[index]
            value_start = index + 1
            index += 1
            escaped = False
            while index < end:
                char = text[index]
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == quote_char:
                    break
                index += 1
            value_end = index
            if index < end:
                index += 1
            result.append((name, value_start, value_end, "quoted"))
            continue

        if text[index] == "{":
            value_start = index
            value_end = _scan_braced_expression(text, index)
            result.append((name, value_start, value_end, "expression"))
            index = value_end
            continue

        value_start = index
        while (
            index < end
            and not text[index].isspace()
            and text[index] not in "/>"
        ):
            index += 1
        result.append((name, value_start, index, "bare"))

    return result


def _static_string_ranges(
    text: str,
    start: int,
    end: int,
    *,
    require_cyrillic: bool = True,
) -> list[tuple[int, int]]:
    """Находит статические части JS-строк, не включая template-интерполяции."""
    result: list[tuple[int, int]] = []
    index = start

    def append_range(value_start: int, value_end: int) -> None:
        value = text[value_start:value_end]
        if value and (not require_cyrillic or CYRILLIC.search(value)):
            result.append((value_start, value_end))

    while index < end:
        if text[index] not in {"'", '"', chr(96)}:
            index += 1
            continue

        quote_char = text[index]
        segment_start = index + 1
        index += 1
        escaped = False

        while index < end:
            char = text[index]
            if escaped:
                escaped = False
                index += 1
                continue
            if char == "\\":
                escaped = True
                index += 1
                continue

            if quote_char == chr(96) and text.startswith("${", index):
                append_range(segment_start, index)
                expression_end = _scan_braced_expression(text, index + 1)
                if expression_end <= index + 2:
                    index += 2
                    segment_start = index
                    continue
                index = expression_end
                segment_start = index
                continue

            if char == quote_char:
                append_range(segment_start, index)
                index += 1
                break

            index += 1
        else:
            append_range(segment_start, end)

    return result


def _property_literal_ranges(
    text: str,
    start: int,
    end: int,
    names: set[str] | frozenset[str] | None = None,
    *,
    require_cyrillic: bool = True,
) -> list[tuple[str, int, int]]:
    """Находит статические строковые значения свойств JS-object literal."""
    result: list[tuple[str, int, int]] = []
    index = start

    while index < end:
        if text.startswith("//", index):
            newline = text.find("\n", index + 2, end)
            index = end if newline == -1 else newline + 1
            continue
        if text.startswith("/*", index):
            closing = text.find("*/", index + 2, end)
            index = end if closing == -1 else closing + 2
            continue

        key = ""
        key_end = index

        if text[index] in {"'", '"'}:
            quote_char = text[index]
            key_start = index + 1
            cursor = key_start
            escaped = False
            while cursor < end:
                char = text[cursor]
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == quote_char:
                    break
                cursor += 1
            key = text[key_start:cursor]
            key_end = min(cursor + 1, end)
        else:
            match = re.match(r"[A-Za-z_$][A-Za-z0-9_$-]*", text[index:end])
            if match is None:
                index += 1
                continue
            key = match.group(0)
            key_end = index + len(key)

        cursor = key_end
        while cursor < end and text[cursor].isspace():
            cursor += 1
        if cursor >= end or text[cursor] != ":":
            index = max(key_end, index + 1)
            continue

        cursor += 1
        while cursor < end and text[cursor].isspace():
            cursor += 1

        if names is not None and key not in names:
            index = max(cursor, index + 1)
            continue
        if cursor >= end or text[cursor] not in {"'", '"', chr(96)}:
            index = max(cursor, index + 1)
            continue

        quote_char = text[cursor]
        value_start = cursor + 1
        cursor += 1
        escaped = False

        while cursor < end:
            char = text[cursor]
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == quote_char:
                break
            cursor += 1

        value_end = cursor
        if quote_char == chr(96):
            result.extend(
                (key, item_start, item_end)
                for item_start, item_end in _static_string_ranges(
                    text,
                    value_start - 1,
                    min(cursor + 1, end),
                    require_cyrillic=require_cyrillic,
                )
            )
        else:
            value = text[value_start:value_end]
            if value and (not require_cyrillic or CYRILLIC.search(value)):
                result.append((key, value_start, value_end))

        index = min(cursor + 1, end)

    return result


def _attribute_text_ranges(
    text: str,
    value_start: int | None,
    value_end: int | None,
    kind: str,
) -> list[tuple[int, int]]:
    if value_start is None or value_end is None:
        return []
    if kind == "quoted":
        value = text[value_start:value_end]
        return [(value_start, value_end)] if CYRILLIC.search(value) else []
    if kind == "expression":
        return _static_string_ranges(text, value_start, value_end)
    return []


def _visible_prop_ranges(
    text: str,
    component: str,
    attributes: list[tuple[str, int | None, int | None, str]],
) -> list[tuple[int, int]]:
    """Возвращает только статический текст props, который реально видит читатель."""
    result: list[tuple[int, int]] = []
    visible_props = DEFAULT_VISIBLE_PROPS | COMPONENT_VISIBLE_PROPS.get(
        component, frozenset()
    )
    by_name = {item[0]: item for item in attributes}

    for name, value_start, value_end, kind in attributes:
        if name in visible_props:
            result.extend(
                _attribute_text_ranges(text, value_start, value_end, kind)
            )

    point = by_name.get("point")
    if component == "MapEmbed" and point and point[3] == "expression":
        _name, start, end, _kind = point
        if start is not None and end is not None:
            result.extend(
                (value_start, value_end)
                for _key, value_start, value_end in _property_literal_ranges(
                    text,
                    start,
                    end,
                    frozenset({"title", "description"}),
                )
            )

    return sorted(set(result))


def editorial_mdx_text(text: str) -> tuple[str, int]:
    """Маскирует MDX/JSX-код, сохраняя видимый статический текст компонентов."""
    chars = list(text)
    visible_prop_chars = 0
    index = 0

    while index < len(text):
        if text.startswith("<!--", index):
            closing = text.find("-->", index + 4)
            end = closing + 3 if closing != -1 else index + 1
            _mask_span(chars, index, end)
            index = end
            continue

        if text[index] == "<" and _looks_like_mdx_tag(text, index):
            end = _scan_mdx_tag(text, index)
            component = _tag_name(text, index, end)
            attributes = _tag_attributes(text, index, end)
            keep = _visible_prop_ranges(text, component, attributes)
            _mask_span(chars, index, end)
            visible_prop_chars += _restore_ranges(chars, text, keep)
            index = end
            continue

        if text[index] == "{":
            end = _scan_braced_expression(text, index)
            _mask_span(chars, index, end)
            index = end
            continue

        index += 1

    return "".join(chars), visible_prop_chars


def remove_fenced_code(text: str) -> str:
    """Remove Markdown code fences before passing reader prose to Humanizer."""
    lines = text.splitlines(keepends=True)
    hidden = False
    character = ""
    width = 0
    result = []
    for line in lines:
        candidate = re.match(r"^ {0,3}(`{3,}|~{3,})", line)
        if not hidden and candidate:
            hidden = True
            character = candidate.group(1)[0]
            width = len(candidate.group(1))
            result.append("\n" if line.endswith("\n") else "")
            continue
        if hidden:
            end = re.match(r"^ {0,3}(" + re.escape(character) + "{" + str(width) + r",})[ \t]*$", line.rstrip("\r\n"))
            if end:
                hidden = False
            result.append("\n" if line.endswith("\n") else "")
            continue
        result.append(line)
    return "".join(result)


def editorial_input(raw: str) -> tuple[str, dict]:
    """Проверяет только читаемый текст страницы без YAML и технической разметки."""
    _frontmatter, body, had_frontmatter = split_frontmatter(raw)
    visible, visible_prop_chars = editorial_mdx_text(remove_fenced_code(body))
    visible = re.sub(r'(`+)[^\n]*?\1', ' ', visible)
    text = visible.strip() + "\n"
    return text, {
        "scope": "whole_article",
        "frontmatter_excluded": had_frontmatter,
        "mdx_syntax_excluded": visible != body,
        "visible_prop_chars": visible_prop_chars,
        "title_included": False,
        "description_included": False,
        "title_chars": 0,
        "description_chars": 0,
        "body_chars": len(body),
        "review_chars": len(text),
    }


def is_russian_page(path: str, raw: str) -> bool:
    normalized = path.replace("\\", "/")
    if normalized.startswith("src/content/docs/en/") or normalized.startswith(
        "src/content/docs/sr/"
    ):
        return False
    text, _scope = editorial_input(raw)
    return len(CYRILLIC.findall(text)) >= 20


def safe_inline(text: str, limit: int = 220) -> str:
    value = re.sub(r"\s+", " ", str(text).strip()).replace("`", "ˋ")
    if len(value) > limit:
        value = value[: limit - 1].rstrip() + "…"
    return value


def quote(text: str, limit: int = 360) -> list[str]:
    value = safe_inline(text, limit)
    return [f"> {value}"] if value else []


def humanizer_sha(root: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return "unknown"


def read_paths(path: Path) -> list[str]:
    if not path.exists():
        return []
    seen: set[str] = set()
    result: list[str] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        item = line.strip()
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def run_report(humanizer, text: str) -> dict:
    return humanizer.run_review(
        text,
        style_id=STYLE_ID,
        evidence_ids=EVIDENCE_REQUEST,
        register=REGISTER,
    )


def delta_findings(head_report: dict, base_report: dict | None) -> list[dict]:
    base_counts = Counter(
        finding_signature(item) for item in (base_report or {}).get("findings", [])
    )
    result: list[dict] = []
    for finding in head_report.get("findings", []):
        signature = finding_signature(finding)
        if base_counts[signature]:
            base_counts[signature] -= 1
        else:
            result.append(finding)
    return result


def plural(number: int, forms: tuple[str, str, str]) -> str:
    n = abs(number) % 100
    n1 = n % 10
    if 10 < n < 20:
        return forms[2]
    if n1 == 1:
        return forms[0]
    if 2 <= n1 <= 4:
        return forms[1]
    return forms[2]


def finding_editor_id(finding: dict) -> str:
    return str(finding.get("reviewer_id") or finding.get("library_id") or "")


def visible_title(finding: dict, editor_id: str) -> str:
    title = str(finding.get("display_rule_ru") or "").strip()
    if title and CYRILLIC.search(title):
        return safe_inline(title, 140)
    phenomenon = str(finding.get("phenomenon_id") or "")
    if phenomenon in KNOWN_TITLES:
        return KNOWN_TITLES[phenomenon]
    return EDITOR_INDEX.get(editor_id, ("", "", "", "Редакторское замечание"))[3]


def visible_reason(finding: dict) -> str:
    phenomenon = str(finding.get("phenomenon_id") or "")
    if phenomenon in KNOWN_REASONS:
        return KNOWN_REASONS[phenomenon]
    reason = str(finding.get("reason") or "").strip()
    if reason and CYRILLIC.search(reason):
        return safe_inline(reason, 420)
    return "Перечитайте этот фрагмент в контексте и решите, делает ли правка текст точнее или легче."


def render_finding(record: dict, editor_id: str, show_path: bool) -> list[str]:
    finding = record["finding"]
    lines = [f"**{visible_title(finding, editor_id)}**", ""]
    if show_path:
        lines.extend([f"_Файл: `{record['path']}`_", ""])
    line = int(finding.get("line", 0) or 0)
    if line:
        lines.extend([f"_Строка: {line}_", ""])
    lines.extend(quote(finding.get("excerpt", "")))
    if finding.get("excerpt"):
        lines.append("")
    lines.append(visible_reason(finding))
    return lines


def render_editor_section(
    number: int,
    editor: tuple[str, str, str, str],
    records: list[dict],
    total_count: int,
    show_path: bool,
) -> str:
    editor_id, emoji, name, _fallback = editor
    lines = [f"### {number}. {emoji} {name}", ""]
    if total_count == 0:
        lines.append("Замечаний нет. ✅")
        return "\n".join(lines)

    lines.append(
        f"Найдено {total_count} {plural(total_count, ('замечание', 'замечания', 'замечаний'))}."
    )
    if len(records) < total_count:
        lines.append(f"Ниже показаны первые {len(records)}.")
    lines.append("")

    for index, record in enumerate(records, 1):
        if total_count > 1:
            lines.extend([f"#### {index}", ""])
        lines.extend(render_finding(record, editor_id, show_path))
        lines.append("")
    return "\n".join(lines).rstrip()


def scope_line(path: str, scope: dict) -> str:
    title = "да" if scope["title_included"] else "нет"
    description = "да" if scope["description_included"] else "нет"
    yaml_note = "исключены" if scope["frontmatter_excluded"] else "не обнаружены"
    mdx_note = "исключён" if scope["mdx_syntax_excluded"] else "не обнаружен"
    return (
        f"- `{path}` — заголовок: {title}; описание: {description}; "
        f"основной текст: {scope['body_chars']} символов; "
        f"всего проверено: {scope['review_chars']} символов; "
        f"прочие служебные поля YAML: {yaml_note}; "
        f"MDX/JSX-синтаксис: {mdx_note}; "
        f"видимый текст props: {scope['visible_prop_chars']} символов."
    )


def build_comment(
    humanizer,
    humanizer_root: Path,
    base_root: Path,
    head_root: Path,
    files_path: Path,
) -> str:
    files = read_paths(files_path)
    sha = humanizer_sha(humanizer_root)
    checked: list[str] = []
    skipped: list[str] = []
    scopes: dict[str, dict] = {}
    libraries_seen: set[str] = set()
    records: list[dict] = []
    board_summaries: list[dict] = []

    for rel in files:
        head_path = head_root / rel
        if not head_path.is_file():
            continue
        head_raw = head_path.read_text(encoding="utf-8")
        if not is_russian_page(rel, head_raw):
            skipped.append(rel)
            continue

        checked.append(rel)
        head_text, head_scope = editorial_input(head_raw)
        scopes[rel] = head_scope
        head_report = run_report(humanizer, head_text)
        libraries_seen.update(head_report.get("metrics", {}).keys())

        base_path = base_root / rel
        base_report = None
        if base_path.is_file():
            base_raw = base_path.read_text(encoding="utf-8")
            base_text, _base_scope = editorial_input(base_raw)
            base_report = run_report(humanizer, base_text)

        new_findings = delta_findings(head_report, base_report)
        board = humanizer.build_board(
            new_findings,
            head_report["style"],
            evidence=head_report.get("evidence", []),
        )
        board_summaries.append(
            {
                "path": rel,
                "guardrails": len(board.get("guardrails", [])),
                "groups": len(board.get("groups", [])),
                "board": board,
            }
        )
        for finding in new_findings:
            records.append({"path": rel, "finding": finding})

    body = [MARKER, f"## 📝 {PUBLIC_TITLE}", ""]

    if not checked:
        body.extend(
            [
                "Изменённых русскоязычных биографических страниц для проверки нет.",
                "",
                "<details>",
                "<summary>🔧 Технические сведения о проверке</summary>",
                "",
                f"Версия: [`Antiokh/humanizer_russian@{sha[:7]}`](https://github.com/Antiokh/humanizer_russian/commit/{sha}).",
                "",
                "</details>",
            ]
        )
        return "\n".join(body).rstrip() + "\n"

    counts = Counter(finding_editor_id(record["finding"]) for record in records)
    active_editors = sum(1 for editor_id, *_rest in EDITORS if counts[editor_id])
    total_findings = sum(counts[editor_id] for editor_id, *_rest in EDITORS)

    if len(checked) == 1:
        body.append("Редколлегия проверила всю изменённую русскоязычную статью.")
    else:
        body.append(
            f"Редколлегия проверила все изменённые русскоязычные страницы ({len(checked)})."
        )
    body.append(
        f"Замечания оставили {active_editors} из {len(EDITORS)} редакторов. "
        f"Всего — {total_findings} "
        f"{plural(total_findings, ('замечание', 'замечания', 'замечаний'))}."
    )
    body.append("")

    for number, editor in enumerate(EDITORS, 1):
        editor_id, emoji, name, _fallback = editor
        count = counts[editor_id]
        status = (
            f"{count} {plural(count, ('замечание', 'замечания', 'замечаний'))}"
            if count
            else "замечаний нет"
        )
        body.append(f"{number}. {emoji} **{name}** — {status}.")
    body.append("")

    visible_records = records[:MAX_ITEMS_TOTAL]
    records_by_editor: dict[str, list[dict]] = {editor_id: [] for editor_id, *_ in EDITORS}
    for record in visible_records:
        editor_id = finding_editor_id(record["finding"])
        if editor_id in records_by_editor:
            records_by_editor[editor_id].append(record)

    show_path = len(checked) > 1
    for number, editor in enumerate(EDITORS, 1):
        editor_id = editor[0]
        body.extend(
            [
                render_editor_section(
                    number,
                    editor,
                    records_by_editor[editor_id],
                    counts[editor_id],
                    show_path,
                ),
                "",
            ]
        )

    omitted = max(0, len(records) - len(visible_records))
    if omitted:
        body.extend(
            [
                f"Ещё {omitted} {plural(omitted, ('замечание', 'замечания', 'замечаний'))} "
                "не показано, чтобы комментарий оставался читаемым.",
                "",
            ]
        )

    repo_link = "https://github.com/Antiokh/humanizer_russian"
    body.extend(
        [
            "<details>",
            "<summary>🔧 Технические сведения о проверке</summary>",
            "",
            f"Проверено по [`Antiokh/humanizer_russian@{sha[:7]}`]({repo_link}/commit/{sha}).",
            f"Внутренний режим: `{STYLE_ID}` / `editorial_board`; регистр: `{REGISTER}`; дополнительные данные: `{EVIDENCE_REQUEST}`.",
            "Для каждого изменённого документа отдельно проверяются полные версии до и после изменения. "
            "В отзыв попадают только новые находки, поэтому старый редакционный долг не приписывается текущему PR.",
            "",
            "**Область проверки:**",
            "",
        ]
    )
    body.extend(scope_line(path, scopes[path]) for path in checked)

    if libraries_seen:
        body.extend(
            [
                "",
                "**Активные внутренние библиотеки:** "
                + ", ".join(f"`{item}`" for item in sorted(libraries_seen))
                + ".",
            ]
        )

    if skipped:
        body.extend(
            [
                "",
                "Пропущены английские, сербские или нерусские MDX-файлы: "
                + ", ".join(f"`{path}`" for path in skipped[:8])
                + ("…" if len(skipped) > 8 else "")
                + ".",
            ]
        )

    body.extend(["", "**Машинные идентификаторы находок:**", ""])
    if not records:
        body.append("Новых машинных находок относительно базовой версии нет.")
    else:
        for record in records[:MAX_ITEMS_TOTAL]:
            finding = record["finding"]
            body.append(
                "- "
                f"`{record['path']}` · "
                f"`{finding.get('library_id')}` · "
                f"`{finding.get('rule_id')}` · "
                f"`{finding.get('phenomenon_id')}` · "
                f"`{finding.get('project_class')}` · "
                f"`{finding.get('verdict')}`"
            )

    body.extend(["", "**Внутренние решения коллегии:**", ""])
    any_groups = False
    for summary in board_summaries:
        board = summary["board"]
        for group in board.get("groups", [])[:MAX_ITEMS_TOTAL]:
            any_groups = True
            body.append(
                "- "
                f"`{summary['path']}` · "
                f"`{group.get('phenomenon_id')}` · "
                f"`{group.get('status')}` → `{group.get('recommendation')}`"
            )
    if not any_groups:
        body.append("Новых редакционных групп относительно базовой версии нет.")

    body.extend(
        [
            "",
            "Это редакторская проверка текста. Она не определяет авторство и не оценивает вероятность использования ИИ.",
            "",
            "</details>",
        ]
    )
    return "\n".join(body).rstrip() + "\n"


def self_test(humanizer, root: Path) -> dict:
    """Защита от передачи служебных полей и несовместимого API."""
    sample = (
        "---\n"
        'title: "Служебный заголовок для проверки"\n'
        'description: "Служебное описание для проверки"\n'
        "entity: person\n"
        "---\n\n"
        "# Детство\n\n"
        "Антон рос в Жулебине. Он ходил в школу и увлекался компьютерами.\n"
        "\n"
        "```python\nprint('Скрытый пример кода')\n```\n"
    )
    article, scope = editorial_input(sample)
    assert "Служебный заголовок" not in article, article
    assert "Служебное описание" not in article, article
    assert "Скрытый пример кода" not in article, article
    assert "Антон рос в Жулебине." in article, article
    assert scope["frontmatter_excluded"]
    assert not scope["title_included"]
    assert not scope["description_included"]
    assert scope["scope"] == "whole_article"

    report = run_report(humanizer, article)
    assert report.get("mode") == "editorial_board", report.get("mode")
    assert report.get("style", {}).get("id") == STYLE_ID, report.get("style")
    libraries = sorted(report.get("metrics", {}).keys())
    assert len(libraries) == len(EDITORS), libraries
    assert delta_findings(report, report) == []
    return {
        "humanizer_sha": humanizer_sha(root),
        "mode": report.get("mode"),
        "style": report.get("style", {}).get("id"),
        "register": report.get("register"),
        "frontmatter_excluded": True,
        "scope": scope["scope"],
        "libraries": libraries,
        "editor_count": len(EDITORS),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--humanizer-root", type=Path, required=True)
    parser.add_argument("--base-root", type=Path)
    parser.add_argument("--head-root", type=Path)
    parser.add_argument("--files", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    humanizer = load_humanizer(args.humanizer_root)
    if args.self_test:
        print(json.dumps(self_test(humanizer, args.humanizer_root), ensure_ascii=False, indent=2))
        return 0

    missing = [
        name
        for name in ("base_root", "head_root", "files", "output")
        if getattr(args, name) is None
    ]
    if missing:
        parser.error(
            "обязательные параметры вне --self-test: "
            + ", ".join("--" + name.replace("_", "-") for name in missing)
        )

    comment = build_comment(
        humanizer,
        args.humanizer_root,
        args.base_root,
        args.head_root,
        args.files,
    )
    args.output.write_text(comment, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
