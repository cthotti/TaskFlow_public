import mongoose, { Schema, model, models } from "mongoose";

export interface RepeatingConfig {
  enabled: boolean;
  type?: "daily" | "everyOther" | "weekly";
  days?: number[]; // for weekly: 0=Sun .. 6=Sat
  startDate?: string; // YYYY-MM-DD — used for everyOther and reference
}

export interface Task {
  _id?: string;
  clientTempID?: string;
  text: string;
  due?: string;
  description?: string;
  color?: string;
  date?: string;
  completed?: boolean;
  carryOver?: boolean;
  repeating?: RepeatingConfig;

}

const RepeatingSchema = new Schema<RepeatingConfig>(
  {
    enabled: { type: Boolean, default: false },
    type: { type: String, enum: ["daily", "everyOther", "weekly"], required: false },
    days: { type: [Number], required: false }, // only for weekly
    startDate: { type: String, required: false }, // YYYY-MM-DD
  },
  { _id: false }
);

const TaskSchema = new Schema<Task>({
  text: { type: String, required: true },
  due: { type: String },
  color: { type: String },
  date: { type: String },
  description: { type: String},
  completed: { type: Boolean, default: false },
  carryOver: { type: Boolean, default: false },
  repeating: { type: RepeatingSchema, default: { enabled: false } },


});

export default models.Task || model<Task>("Task", TaskSchema);
