"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Note {
  _id: string;
  title: string;
}

interface SidebarProps {
  beforeNavigate?: () => Promise<void>; // function passed in from NoteEditor
}

export default function Sidebar({ beforeNavigate }: SidebarProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/notes")
      .then((res) => res.json())
      .then((data) => setNotes(data));
  }, []);

  const navigate = async (path: string) => {
    if (beforeNavigate) await beforeNavigate(); // ✅ save first
    router.push(path);
  };

  const addNote = async () => {
    if (beforeNavigate) await beforeNavigate();
    const res = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Untitled Note", content: "" }),
    });
    const newNote = await res.json();
    setNotes((prev) => [...prev, newNote]);
    router.push(`/notes/${newNote._id}`);
  };

  return (
    <div className="flex flex-col w-28 bg-black text-white items-center pt-10">
      <div className="flex flex-col space-y-6 pb-6 items-center mt-16">
        {/* Home */}
        <button
          onClick={() => navigate("/")}
          className="w-20 py-2 bg-white text-black rounded-lg font-medium shadow-md hover:bg-gray-200"
        >
          Home
        </button>

        {/* Notes */}
        {notes.map((n) => (
          <button
            key={n._id}
            onClick={() => navigate(`/notes/${n._id}`)}
            className="w-20 py-2 bg-gray-100 text-black rounded-lg shadow-sm hover:bg-gray-200 truncate"
          >
            {n.title || "Untitled"}
          </button>
        ))}

        {/* Add new note */}
        <button
          onClick={addNote}
          className="text-3xl font-bold text-white hover:text-gray-300"
        >
          +
        </button>
      </div>

      <div className="mt-6 text-center text-gray-400 text-sm">
        Task Features
      </div>
    </div>
  );
}
