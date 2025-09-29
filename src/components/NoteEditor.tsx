"use client";
import { useEffect, useState, useRef } from "react";
import Sidebar from "@/components/Sidebar";

interface Note {
  _id: string;
  title: string;
  content: string;
}

interface NoteEditorProps {
  noteId: string;
}

// tiny arrows
const ARROW_FILLED = "➔";
const ARROW_HOLLOW = "➝";
const INDENT_STR = "    "; // 4 spaces

export default function NoteEditor({ noteId }: NoteEditorProps) {
  const [note, setNote] = useState<Note | null>(null);
  const [loaded, setLoaded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/notes/${noteId}`);
      const data: Note = await res.json();
      setNote(data);
      setLoaded(true);
    })();
  }, [noteId]);

  const saveNote = async () => {
    if (!note) return;
    await fetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: note.title, content: note.content }),
    });
  };

  // auto-expand
  useEffect(() => {
    if (textareaRef.current) {
      const ta = textareaRef.current;
      const prevTop = ta.scrollTop;
      ta.style.height = "auto";
      ta.style.height = ta.scrollHeight + "px";
      ta.scrollTop = prevTop; // prevent viewport jump
    }
  }, [note?.content]);

  // ---------- helpers
  const markerRe = /^(\s*)(\d+|[A-Z]|[a-z])\s(➔|➝)\s/;

  const getMarker = (level: number, index: number) => {
    // level: 0=number➔, 1=Upper➔, 2=lower➔, 3=number➝
    if (level === 0) return `${index + 1} ${ARROW_FILLED} `;
    if (level === 1) return `${String.fromCharCode(65 + index)} ${ARROW_FILLED} `;
    if (level === 2) return `${String.fromCharCode(97 + index)} ${ARROW_FILLED} `;
    return `${index + 1} ${ARROW_HOLLOW} `;
  };

  const detectLevel = (token: string, arrow: string) => {
    if (/^\d+$/.test(token) && arrow === ARROW_FILLED) return 0;
    if (/^[A-Z]$/.test(token)) return 1;
    if (/^[a-z]$/.test(token)) return 2;
    if (/^\d+$/.test(token) && arrow === ARROW_HOLLOW) return 3;
    return 0;
  };

  const lineBounds = (text: string, caret: number) => {
    const start = text.lastIndexOf("\n", caret - 1) + 1;
    const end = text.indexOf("\n", caret);
    return { start, end: end === -1 ? text.length : end };
  };

  // nearest previous numeric at same indent → next number
  const nextNumberAtIndent = (text: string, uptoIndex: number, indent: string) => {
    const upText = text.slice(0, uptoIndex);
    const lines = upText.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = lines[i].match(markerRe);
      if (m && m[1] === indent && /^\d+$/.test(m[2])) {
        return parseInt(m[2], 10) + 1;
      }
    }
    return 1;
  };

  const replaceCurrentLine = (
    text: string,
    lineStart: number,
    lineEnd: number,
    newLine: string
  ) => text.slice(0, lineStart) + newLine + text.slice(lineEnd);

  // ---------- inline replacement helpers ----------
  const escapeForRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  /**
   * Replace short sequences immediately before caret with desired symbols.
   * Returns { text, caret } updated.
   */
  const applyInlineReplacements = (text: string, caret: number) => {
    if (!text || caret == null) return { text, caret };

    // prefix = everything before caret
    const prefix = text.slice(0, caret);
    const suffix = text.slice(caret);

    // ordered replacements (longer sequences first)
    const replacements: [RegExp, string][] = [
      [new RegExp(escapeForRegex("-->") + "$"), ARROW_FILLED], // --> => filled arrow
      [new RegExp(escapeForRegex("<--") + "$"), "←"], // <-- => left arrow
      [new RegExp(escapeForRegex("->") + "$"), "→"],
      [new RegExp(escapeForRegex("<-") + "$"), "←"],
      // you can add more sequences here
    ];

    for (const [rx, repl] of replacements) {
      const m = prefix.match(rx);
      if (m) {
        const newPrefix = prefix.replace(rx, repl);
        const newText = newPrefix + suffix;
        const newCaret = newPrefix.length;
        return { text: newText, caret: newCaret };
      }
    }
    return { text, caret };
  };

  // ---------- key handling
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!textareaRef.current || !note) return;

    const ta = textareaRef.current;
    const caret = ta.selectionStart;
    const text = note.content;
    const { start: lineStart, end: lineEnd } = lineBounds(text, caret);
    const line = text.slice(lineStart, lineEnd);

    // NEW: if the current line is exactly "/table" and user presses Enter → expand to a markdown table
    if (e.key === "Enter" && line.trim() === "/table") {
      e.preventDefault();

      // simple 2-column table template (header + divider + one data row)
      const tableTemplate = `| Column 1 | Column 2 |\n| --- | --- |\n|  |  |\n`;
      const updated = replaceCurrentLine(text, lineStart, lineEnd, tableTemplate);

      setNote({ ...note, content: updated });

      requestAnimationFrame(() => {
        // place caret inside the first data cell (between the pipes)
        // compute caret pos: start + headerLen + newline + dividerLen + newline + 2 (after "| ")
        const headerLen = "| Column 1 | Column 2 |".length;
        const dividerLen = "\n| --- | --- |".length;
        const dataRowPrefixLen = headerLen + dividerLen + 2; // +2 to land after the pipe+space
        const newCaretPos = lineStart + dataRowPrefixLen;
        ta.selectionStart = ta.selectionEnd = newCaretPos;
      });
      return;
    }

    // 1) "-" + space at start → start/continue numbered list at indent (Docs-like)
    if (e.key === " " && line.trim() === "-") {
      e.preventDefault();

      const baseIndent = (line.match(/^(\s*)-$/) || ["", ""])[1];
      const indent = baseIndent || INDENT_STR; // ensure slight outdent from page edge
      const nextNum = nextNumberAtIndent(text, lineStart, indent);
      const newLine = `${indent}${nextNum} ${ARROW_FILLED} `;

      const updated = replaceCurrentLine(text, lineStart, lineEnd, newLine);
      setNote({ ...note, content: updated });

      requestAnimationFrame(() => {
        const pos = lineStart + newLine.length;
        ta.selectionStart = ta.selectionEnd = pos;
      });
      return;
    }

    // 2) Enter → continue series (numbers/Upper/lower/hollow numbers)
    if (e.key === "Enter") {
      const m = line.match(markerRe);
      if (m) {
        e.preventDefault();
        const indent = m[1];
        const token = m[2];
        const arrow = m[3];
        const level = detectLevel(token, arrow);

        let nextMarker = "";
        if (level === 0 || level === 3) {
          const n = parseInt(token, 10) + 1;
          nextMarker = `${n} ${arrow} `;
        } else if (level === 1) {
          const idx = token.charCodeAt(0) - 65 + 1;
          nextMarker = getMarker(1, idx);
        } else {
          const idx = token.charCodeAt(0) - 97 + 1;
          nextMarker = getMarker(2, idx);
        }

        const insertion = `\n${indent}${nextMarker}`;
        const updated = text.slice(0, caret) + insertion + text.slice(caret);
        setNote({ ...note, content: updated });

        requestAnimationFrame(() => {
          ta.selectionStart = ta.selectionEnd = caret + insertion.length;
        });
        return;
      }
    }

    // 3) Tab → indent & cycle style:
    if (e.key === "Tab" && !e.shiftKey) {
      const m = line.match(markerRe);
      if (m) {
        e.preventDefault();

        let indent = m[1];
        const token = m[2];
        const arrow = m[3];
        let level = detectLevel(token, arrow);

        // first tab when at this indent: add one level & go to A➔
        if (level === 0 && indent.length >= 0) {
          indent = indent + INDENT_STR;
          level = 1;
        } else if (level === 1) {
          level = 2;
        } else if (level === 2) {
          level = 3;
        } else {
          // number➝ → number➔ and outdent
          level = 0;
          if (indent.length >= INDENT_STR.length) {
            indent = indent.slice(0, -INDENT_STR.length);
          }
        }

        // choose index for numeric styles at this indent
        let idx = 0;
        if (level === 0 || level === 3) {
          const nextNum = nextNumberAtIndent(text, lineStart, indent);
          idx = nextNum - 1;
        }

        const rest = line.replace(markerRe, "");
        const newMarker =
          level === 1 ? `A ${ARROW_FILLED} `
          : level === 2 ? `a ${ARROW_FILLED} `
          : getMarker(level, idx);
        const newLine = `${indent}${newMarker}${rest}`;

        const updated = replaceCurrentLine(text, lineStart, lineEnd, newLine);
        setNote({ ...note, content: updated });

        requestAnimationFrame(() => {
          const pos = lineStart + indent.length + newMarker.length;
          ta.selectionStart = ta.selectionEnd = pos; // caret stays on same visual line
        });
        return;
      }
    }

    // 4) Shift+Tab → cycle backward & outdent sensibly
    if (e.key === "Tab" && e.shiftKey) {
      const m = line.match(markerRe);
      if (m) {
        e.preventDefault();

        let indent = m[1];
        const token = m[2];
        const arrow = m[3];
        let level = detectLevel(token, arrow);

        if (level === 0) {
          // numeric➔ → numeric➝ at parent level
          if (indent.length >= INDENT_STR.length) {
            indent = indent.slice(0, -INDENT_STR.length);
          }
          level = 3;
        } else if (level === 3) {
          level = 2;
        } else if (level === 2) {
          level = 1;
        } else {
          // A➔ → number➔ (keep indent)
          level = 0;
        }

        let idx = 0;
        if (level === 0 || level === 3) {
          const nextNum = nextNumberAtIndent(text, lineStart, indent);
          idx = nextNum - 1;
        }

        const rest = line.replace(markerRe, "");
        const newMarker =
          level === 1 ? `A ${ARROW_FILLED} `
          : level === 2 ? `a ${ARROW_FILLED} `
          : getMarker(level, idx);
        const newLine = `${indent}${newMarker}${rest}`;

        const updated = replaceCurrentLine(text, lineStart, lineEnd, newLine);
        setNote({ ...note, content: updated });

        requestAnimationFrame(() => {
          const pos = lineStart + indent.length + newMarker.length;
          ta.selectionStart = ta.selectionEnd = pos;
        });
        return;
      }
    }
  };

  // ---------- change handler (handles inline replacements while typing) ----------
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const raw = e.target.value;
    const caret = e.target.selectionStart ?? raw.length;

    // apply inline replacements near caret
    const { text: replacedText, caret: newCaret } = applyInlineReplacements(raw, caret);

    // Update note content and restore caret after DOM update
    setNote((prev) => (prev ? { ...prev, content: replacedText } : prev));

    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      try {
        ta.selectionStart = ta.selectionEnd = newCaret;
      } catch {
        // ignore if DOM not ready yet
      }
    });
  };

  if (!loaded || !note) {
    return (
      <div className="flex min-h-screen bg-[#0B0909] text-white">
        <Sidebar beforeNavigate={saveNote} />
        <div className="w-px bg-gray-600" />
        <main className="flex-1 flex items-center justify-center">Loading...</main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#0B0909] text-white">
      <Sidebar beforeNavigate={saveNote} />
      <div className="w-px bg-gray-600" />
      <main className="flex-1 flex flex-col px-6 py-10">
        <div className="w-full max-w-5xl mx-auto">
          <input
            type="text"
            value={note.title}
            onChange={(e) => setNote({ ...note, title: e.target.value })}
            placeholder="Untitled Note"
            className="w-full bg-transparent border-none outline-none text-4xl font-bold tracking-tight mb-2 text-white"
          />
          <div className="w-full h-px bg-gray-600 mb-6"></div>
          <textarea
            ref={textareaRef}
            value={note.content}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Start typing here..."
            className="w-full bg-transparent border-none outline-none text-lg leading-7 text-gray-200 resize-none overflow-hidden"
            style={{ minHeight: "calc(100vh - 200px)", whiteSpace: "pre-wrap" }}
          />
        </div>
      </main>
    </div>
  );
}
