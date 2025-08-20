import NoteEditor from "@/components/NoteEditor";

export default function NotePage({ params }: { params: { id: string } }) {
  return (
    <div className="flex w-full">
      <NoteEditor id={params.id} />
    </div>
  );
}
