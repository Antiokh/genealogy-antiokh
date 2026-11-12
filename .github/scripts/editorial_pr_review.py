#!/usr/bin/env python3
"""Read-only editorial suggestions for changed prose; never edit content files."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

MARKER = "<!-- editorial-pr-review -->"
EDITOR_NAMES = {
    "russian": "Русский язык",
    "native": "Живой русский",
    "chukovsky": "Корней Чуковский",
    "gal": "Нора Галь",
    "ilyakhov": "Максим Ильяхов и Людмила Сарычева",
    "visson": "Линн Виссон",
    "rosenthal": "Д. Э. Розенталь",
    "golub": "И. Б. Голуб",
}
META = re.compile(
    r"в этой карточке|в данной карточке|в данном разделе|"
    r"в (?:этой|данной) записи|во frontmatter|в yaml|"
    r"в нашем проекте отмечено|структурированные события ниже|"
    r"сохранено в (?:frontmatter|поле)|редакционная проверка",
    re.I,
)
EN_STOCK = re.compile(
    r"in today.s fast.paced world|in an ever.evolving landscape|"
    r"now more than ever|delve into|unlock the potential|"
    r"game.changing|cutting.edge|a testament to|"
    r"tapestry of|leverage (?:the|this|our|its) ",
    re.I,
)


def mask(text: str) -> str:
    return "".join("\n" if c == "\n" else " " for c in text)


def prose_only(raw: str) -> str:
    """Preserve absolute source lines while removing YAML, fenced code and MDX syntax."""
    lines = raw.splitlines(keepends=True)
    if lines and lines[0].strip() == "---":
        end = next((i for i in range(1, len(lines)) if lines[i].strip() in ("---", "...")), None)
        if end is not None:
            for i in range(end + 1):
                lines[i] = mask(lines[i])

    fence = None
    for i, line in enumerate(lines):
        stripped = line.lstrip()
        found = re.match(r"^(`{3,}|~{3,})", stripped)
        if found:
            token = found.group(1)
            if fence is None:
                fence = token[0]
            elif fence == token[0]:
                fence = None
            lines[i] = mask(line)
            continue
        if fence:
            lines[i] = mask(line)
            continue
        if re.match(r"^\s*(?:\||\[\^[^]]+\]:|//)", line):
            lines[i] = mask(line)

    value = "".join(lines)
    for rx in [
        r"<!--[\s\S]*?-->",
        r"<[A-Z][A-Za-z0-9.]*(?:\s[^<>]*?)?/?>",
        r"</[A-Z][A-Za-z0-9.]*\s*>",
        r"\{[^{}\n]*\}",
        r"`[^`\n]+`",
        r"!?\[[^\]]*\]\([^\n)]*\)",
    ]:
        value = re.sub(rx, lambda m: mask(m.group()), value)
    assert value.count("\n") == raw.count("\n")
    return value


def scan(mode: str, tool_root: Path, path: str, text: str) -> list[dict]:
    if mode == "genealogy":
        scripts = tool_root / "scripts"
        sys.path.insert(0, str(scripts))
        spec = importlib.util.spec_from_file_location("genealogy_editorial_review", scripts / "review.py")
        if spec is None or spec.loader is None:
            raise RuntimeError("Pinned humanizer_russian review.py not available")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        report = module.run_review(text, style_id="neutral", evidence_ids=None, register="general")
        findings = [{
            "editor": str(f.get("reviewer_id") or f.get("library_id") or "native"),
            "rule": str(f.get("rule_id") or f.get("phenomenon_id") or ""),
            "title": str(f.get("display_rule_ru") or "Редакторское замечание"),
            "excerpt": str(f.get("excerpt") or ""),
            "reason": str(f.get("reason") or "Перечитайте фрагмент в контексте биографии."),
        } for f in report.get("findings", [])]
        for line in text.splitlines():
            for match in META.finditer(line):
                findings.append({
                    "editor": "biography", "rule": "biography.meta",
                    "title": "Служебная речь вместо биографии",
                    "excerpt": match.group(),
                    "reason": "Оставьте описание редакционной работы в исследовательских заметках; читательский текст должен рассказывать о человеке.",
                })
        return findings
    if mode == "patriarchy":
        if path.startswith("src/content/docs/ru/"):
            spec = importlib.util.spec_from_file_location("patriarchy_humanizer", tool_root / "scripts/lint.py")
            if spec is None or spec.loader is None:
                raise RuntimeError("Pinned humanizer--ru lint.py not available")
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return [{
                "editor": "russian", "rule": rule, "title": kind + ": " + rule,
                "excerpt": excerpt, "reason": (
                    "Проверьте формулировку, не меняя тезис, голос автора, факты или нормативную русскую типографику."
                ),
            } for kind, _line, rule, excerpt in module.lint(text)]
        return [{
            "editor": "english", "rule": "english.stock_phrase",
            "title": "Formulaic English phrasing",
            "excerpt": match.group(),
            "reason": "Review this stock phrase against the article's intended voice; do not neutralize deliberate rhetoric.",
        } for match in EN_STOCK.finditer(text)]
    raise ValueError("Unknown mode " + mode)


def key(item: dict) -> tuple[str, str, str]:
    return (
        item["editor"], item["rule"],
        re.sub(r"\s+", " ", item["excerpt"]).strip().casefold()[:180],
    )


def delta(current: list[dict], old: list[dict]) -> list[dict]:
    before = Counter(key(item) for item in old)
    result = []
    for item in current:
        identity = key(item)
        if before[identity]:
            before[identity] -= 1
        else:
            result.append(item)
    return result


def safe(value: str, limit: int = 300) -> str:
    text = re.sub(r"\s+", " ", str(value)).strip().replace("<", "&lt;").replace(">", "&gt;")
    return text[:limit] + ("…" if len(text) > limit else "")


def inline(path: str, raw: str, visible: str, item: dict) -> dict | None:
    excerpt = item["excerpt"].strip()
    if len(excerpt) < 12 or any(c in excerpt for c in "\n\r"):
        return None
    if raw.casefold().count(excerpt.casefold()) != 1:
        return None
    if visible.casefold().count(excerpt.casefold()) != 1:
        return None
    at = raw.casefold().find(excerpt.casefold())
    line = raw.count("\n", 0, at) + 1
    identity = hashlib.sha256(
        (path + "\0" + "\0".join(key(item))).encode("utf8")
    ).hexdigest()[:20]
    return {
        "path": path, "line": line, "id": identity,
        "body": (
            "**" + safe(item["title"], 130) + "**\n\n> " +
            safe(item["excerpt"], 200) + "\n\n" + safe(item["reason"], 360) +
            "\n\n<!-- humanizer-inline:" + identity + " -->"
        ),
    }


def include(mode: str, path: str) -> bool:
    if not path.startswith("src/content/docs/") or not path.endswith((".md", ".mdx")):
        return False
    if mode == "genealogy":
        return path.startswith("src/content/docs/people/")
    return True


def report(mode: str, tool_root: Path, base: Path, head: Path, paths: list[str]) -> tuple[str, list[dict]]:
    records, suggestions, checked = [], [], []
    for rel in sorted(set(paths)):
        if not include(mode, rel):
            continue
        source = head / rel
        if not source.is_file():
            continue
        head_raw = source.read_text("utf-8")
        visible = prose_only(head_raw)
        if mode == "genealogy" and len(re.findall(r"[а-яё]", visible, re.I)) < 20:
            continue
        if mode == "patriarchy" and rel.startswith("src/content/docs/ru/") and len(re.findall(r"[а-яё]", visible, re.I)) < 20:
            continue
        checked.append(rel)
        current = scan(mode, tool_root, rel, visible)
        previous = base / rel
        old = scan(mode, tool_root, rel, prose_only(previous.read_text("utf-8"))) if previous.is_file() else []
        for item in delta(current, old):
            records.append((rel, item))
            note = inline(rel, head_raw, visible, item)
            if note:
                suggestions.append(note)

    title = "Редакторская проверка биографий" if mode == "genealogy" else "Редакторская проверка статей"
    groups = defaultdict(list)
    for path, item in records:
        groups[item["editor"]].append((path, item))
    body = [
        MARKER,
        "## 📝 " + title,
        "",
        f"Проверено страниц: **{len(checked)}**. Новых замечаний: **{len(records)}**.",
        "Замечания являются рекомендациями. Источники, цитаты, факты и исходные статьи не изменяются.",
        "",
    ]
    names = (
        [*EDITOR_NAMES.keys(), "biography"] if mode == "genealogy" else ["russian", "english"]
    )
    labels = dict(EDITOR_NAMES, biography="Биографический жанр", english="English style (heuristic checks)")
    for editor in names:
        items = groups[editor]
        body += [
            "<details>",
            f"<summary>{labels[editor]} — {len(items)} замечаний</summary>",
            "",
        ]
        if not items:
            body.append("Замечаний нет.")
        else:
            for rel, item in items[:20]:
                body += [
                    "**" + safe(item["title"], 150) + "** · `" + rel + "`",
                    "",
                    "> " + safe(item["excerpt"], 250),
                    "",
                    safe(item["reason"], 420),
                    "",
                ]
            if len(items) > 20:
                body.append(f"Ещё {len(items)-20} находок скрыто для краткости.")
        body += ["", "</details>", ""]
    body += [
        "<details>", "<summary>🔧 Технические сведения</summary>", "",
        "Рецензия выполняется только по видимой прозе; YAML, MDX-разметка, код и ссылки исключены.",
        "Публикуются только новые находки относительно base PR.",
        "Inline-комментарии добавляются только на однозначно найденных строках, которые реально входят в diff.",
        "Версия проверяющего кода закреплена SHA в workflow.",
        "",
        "</details>", "",
    ]
    return "\n".join(body), suggestions


def self_test() -> None:
    sample = "---\ntitle: Test\n---\nПростой абзац.\n<Thing title=\"Карта\" />\n```js\nкод\n```\n"
    result = prose_only(sample)
    assert result.count("\n") == sample.count("\n")
    assert "Простой абзац." in result and "Thing" not in result and "код" not in result
    assert delta([{"editor": "a", "rule": "r", "excerpt": "new"}], []) != []
    assert delta([{"editor": "a", "rule": "r", "excerpt": "old"}], [{"editor": "a", "rule": "r", "excerpt": "old"}]) == []
    note = {"editor": "a", "rule": "r", "title": "T", "excerpt": "Простой абзац.", "reason": "R"}
    assert inline("file.mdx", sample, result, note)["line"] == 4
    assert inline("file.mdx", sample + "Простой абзац.", result, note) is None
    print("Editorial prose mask, delta and inline mapping: OK")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mode", choices=["genealogy", "patriarchy"], required=True)
    parser.add_argument("--tool-root", type=Path)
    parser.add_argument("--base-root", type=Path)
    parser.add_argument("--head-root", type=Path)
    parser.add_argument("--files", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--inline-output", type=Path)
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    for value in ("tool_root", "base_root", "head_root", "files", "output", "inline_output"):
        if getattr(args, value) is None:
            parser.error("Missing --" + value.replace("_", "-"))
    files = args.files.read_text("utf-8").splitlines()
    comment, notes = report(args.mode, args.tool_root, args.base_root, args.head_root, files)
    args.output.write_text(comment, encoding="utf-8")
    args.inline_output.write_text(json.dumps(notes, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
