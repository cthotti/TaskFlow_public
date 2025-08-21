// src/app/notes/[id]/page.tsx
import NoteEditor from "@/components/NoteEditor";

// Don't import PageProps from 'next'. Define a simple local type instead.
type Props = {
  params: { id: string };
};

export default function NotePage({ params }: Props) {
  const { id } = params;
  return <NoteEditor noteId={id} />;
}
