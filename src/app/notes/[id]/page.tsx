// src/app/notes/[id]/page.tsx
import NoteEditor from "@/components/NoteEditor";

interface NotePageProps {
  params: {
    id: string;
  };
}

export default function NotePage({ params }: NotePageProps) {
  const { id } = params;

  return <NoteEditor noteId={id} />;
}
