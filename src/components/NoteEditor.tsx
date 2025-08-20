"use client";
import { useState, useEffect } from "react";

interface Note {
  _id: string;
  title: string;
  content: string;
}

export default function NoteEditor({ id }: { id: string }) {
  const [note, setNote] = useState<Note | null>(null);

  useEffect(() => {
    fetch(`/api/notes/${id}`)
      .then(res => res.json())
      .then(setNote);
  }, [id]);

  const saveNote = async (field: string, value: string) => {
    if (!note) return;
    const updated = { ...note, [field]: value };
    setNote(updated);
    await fetch(`/api/notes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updated),
    });
  };

  if (!note) return <p>Loading...</p>;

  return (
    <div className="flex flex-col w-full p-4">
      <input
        className="text-2xl font-bold bg-transparent border-b border-gray-600 mb-2"
        value={note.title}
        onChange={(e) => saveNote("title", e.target.value)}
      />
      <textarea
        className="flex-1 bg-transparent border border-gray-600 rounded p-2"
        value={note.content}
        onChange={(e) => saveNote("content", e.target.value)}
      />
    </div>
  );
}
