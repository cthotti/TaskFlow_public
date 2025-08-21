"use client";
import { useEffect, useState } from "react";
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
  const [loaded, setLoaded] = useState(false);

  // Fetch note once
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/notes/${noteId}`);
      const data: Note = await res.json();
      setNote(data);
      setLoaded(true);
    })();
  }, [noteId]);

  // Save note (manual trigger, called by Sidebar)
  const saveNote = async () => {
    if (!note) return;
    await fetch(`/api/notes/${noteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: note.title, content: note.content }),
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
      <main className="flex-1 flex flex-col p-10 items-center">
        <div className="w-full max-w-3xl">
          {/* Title */}
          <input
            type="text"
            value={note.title}
            onChange={(e) => setNote({ ...note, title: e.target.value })}
            placeholder="Untitled Note"
            className="w-full bg-[#0B0909] border border-black outline-none 
                       text-4xl font-bold tracking-tight mb-3 text-white"
          />

          {/* Divider */}
          <div className="w-3/4 h-px bg-gray-600 mb-6"></div>

          {/* Body */}
          <textarea
            value={note.content}
            onChange={(e) => setNote({ ...note, content: e.target.value })}
            placeholder="Start typing here..."
            className="w-full bg-[#0B0909] border border-black outline-none 
                       text-lg leading-7 text-gray-200 resize-none"
            style={{ minHeight: "70vh" }}
          />
        </div>
      </main>
    </div>
  );
}
