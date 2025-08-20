"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Note {
  _id: string;
  title: string;
}

export default function Sidebar() {
  const [notes, setNotes] = useState<Note[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/notes")
      .then(res => res.json())
      .then(setNotes);
  }, []);

  const addNote = async () => {
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled Note", content: "" }),
    });
    const newNote = await res.json();
    setNotes(prev => [...prev, newNote]);
    router.push(`/notes/${newNote._id}`);
  };

  return (
    <div className="flex flex-col w-20 bg-black text-white space-y-4 p-2">
      <button onClick={() => router.push("/")}>Home</button>
      {notes.map((n, i) => (
        <button key={n._id} onClick={() => router.push(`/notes/${n._id}`)}>
          {`Note ${i + 1}`}
        </button>
      ))}
      <button onClick={addNote} className="bg-white text-black rounded-md">
        +
      </button>
    </div>
  );
}
