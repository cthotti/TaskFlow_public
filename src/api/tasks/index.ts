import { NextApiRequest, NextApiResponse } from "next";
import mongoose from "mongoose";
import Task from "@/models/Task";
import clientPromise from "@/lib/db";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  await clientPromise;

  if (req.method === "GET") {
    const tasks = await Task.find({});
    return res.status(200).json({ tasks });
  }

  if (req.method === "POST") {
    const { text, due } = req.body;
    const colors = ["#fde68a", "#bfdbfe", "#bbf7d0", "#fbcfe8", "#fcd34d"];
    const color = colors[Math.floor(Math.random() * colors.length)];
    const task = await Task.create({ text, due, color });
    return res.status(201).json({ task });
  }

  return res.status(405).end();
}
