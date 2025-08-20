import mongoose, { Schema, model, models } from "mongoose";

const NoteSchema = new Schema(
  {
    title: { type: String, required: true, default: "Untitled Note" },
    content: { type: String, default: "" },
  },
  { timestamps: true }
);

const Note = models.Note || model("Note", NoteSchema);
export default Note;
