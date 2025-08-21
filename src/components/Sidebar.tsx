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
      .then((res) => res.json())
      .then((data) => setNotes(data));
  }, []);

  const addNote = async () => {
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
      {/* Home + Notes section */}
      <div className="flex flex-col space-y-6 pb-6 items-center">
        <button
          onClick={() => router.push("/")}
          className="w-16 py-2 bg-white text-black rounded-lg font-medium shadow-md hover:bg-gray-200"
        >
          Home
        </button>

        {notes.map((n, i) => (
          <button
            key={n._id}
            onClick={() => router.push(`/notes/${n._id}`)}
            className="w-16 py-2 bg-gray-100 text-black rounded-lg shadow-sm hover:bg-gray-200"
          >
            {`Note ${i + 1}`}
          </button>
        ))}

        {/* Plain + button */}
        <button
          onClick={addNote}
          className="text-3xl font-bold text-white hover:text-gray-300"
        >
          +
        </button>
      </div>

      {/* Task features */}
      <div className="mt-6 text-center text-gray-400 text-sm">
        Task Features
      </div>
    </div>
  );
}
