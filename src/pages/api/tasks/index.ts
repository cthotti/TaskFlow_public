
import type { NextApiRequest, NextApiResponse } from "next";
import connectDB from "@/lib/db";
import Task from "@/models/Task";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await connectDB();

  if (req.method === "GET") {
    const tasks = await Task.find({});
    return res.status(200).json({ tasks });
  }

  if (req.method === "POST") {
    const { text, due } = req.body;

    const colors = [
  "#E1A36F", "#DEC484", "#E2D8A5","#6F9F9C","#577E89"
];
    const color = colors[Math.floor(Math.random() * colors.length)];

    const task = await Task.create({ text, due, color });
    return res.status(201).json({ task });
  }

  return res.status(405).json({ message: "Method Not Allowed" });
}
