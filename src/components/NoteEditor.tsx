"use client";
import { useEffect, useRef, useState } from "react";
import Sidebar from "@/components/Sidebar";

interface Note {
  _id: string;
  title: string;
  content: string;
}

interface NoteEditorProps {
  noteId: string;
}

export default function NoteEditor({ noteId }: NoteEditorProps) {
  const [note, setNote] = useState<Note | null>(null);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load note content once
  useEffect(() => {
    fetch(`/api/notes/${noteId}`)
      .then((res) => res.json())
      .then((data: Note) => {
        setNote(data);
        if (titleRef.current) titleRef.current.innerText = data?.title || "";
        if (bodyRef.current) bodyRef.current.innerText = data?.content || "";
      });
  }, [noteId]);

  // Debounced save (only send the changed field, update UI with backend response)
  const scheduleSave = (field: "title" | "content", value: string) => {
    if (!note) return;

    // Optimistically update local UI
    setNote({ ...note, [field]: value });

    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/notes/${noteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }), // ✅ only send one field
      });

      if (res.ok) {
        const updated: Note = await res.json();
        setNote(updated); // ✅ sync local state with DB response
      }
    }, 400);
  };

  const handleTitleInput = () => {
    scheduleSave("title", titleRef.current?.innerText ?? "");
  };

  const handleBodyInput = () => {
    scheduleSave("content", bodyRef.current?.innerText ?? "");
  };

  const handlePastePlain = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const text = e.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
  };

  // Shared frame keeps sidebar
  const Frame = ({ children }: { children: React.ReactNode }) => (
    <div className="flex min-h-screen bg-[#0B0909] text-white">
      <Sidebar />
      <div className="w-px bg-gray-600" />
      <main className="flex-1 flex flex-col p-10 items-center">{children}</main>
    </div>
  );

  if (!note) {
    return (
      <Frame>
        <div className="w-full max-w-3xl text-gray-300">Loading...</div>
      </Frame>
    );
  }

  return (
    <Frame>
      <div className="w-full max-w-3xl">
        {/* Title */}
        <h1
          ref={titleRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleTitleInput}
          onPaste={handlePastePlain}
          className="outline-none text-4xl font-bold tracking-tight mb-3"
          aria-label="Note title"
          data-placeholder="Untitled Note"
        >
          {note.title}
        </h1>

        {/* Divider (3/4 width) */}
        <div className="w-3/4 h-px bg-gray-600 mb-6"></div>

        {/* Body */}
        <div
          ref={bodyRef}
          contentEditable
          suppressContentEditableWarning
          onInput={handleBodyInput}
          onPaste={handlePastePlain}
          className="outline-none text-lg leading-7 whitespace-pre-wrap text-gray-200"
          style={{ minHeight: "70vh" }}
          aria-label="Note content"
          data-placeholder="Start typing here..."
        >
          {note.content}
        </div>
      </div>
    </Frame>
  );
}
