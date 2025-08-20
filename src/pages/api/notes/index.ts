import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import Note from "@/models/Note";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();

  if (req.method === "GET") {
    const notes = await Note.find({});
    return res.status(200).json(notes);
  }

  if (req.method === "POST") {
    const { title, content } = req.body;
    const note = await Note.create({ title, content });
    return res.status(201).json(note);
  }

  return res.status(405).end();
}
