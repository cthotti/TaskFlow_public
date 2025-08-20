import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import Note from "@/models/Note";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();
  const { id } = req.query;

  if (req.method === "GET") {
    const note = await Note.findById(id);
    return res.status(200).json(note);
  }

  if (req.method === "PATCH") {
    const { title, content } = req.body;
    const updated = await Note.findByIdAndUpdate(
      id,
      { title, content },
      { new: true }
    );
    return res.status(200).json(updated);
  }

  if (req.method === "DELETE") {
    await Note.findByIdAndDelete(id);
    return res.status(200).json({ message: "Note deleted" });
  }

  return res.status(405).end();
}
