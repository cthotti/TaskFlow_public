import mongoose from "mongoose";

const TaskSchema = new mongoose.Schema({
  text: String,
  due: String,
  color: String,
});

export default mongoose.models.Task || mongoose.model("Task", TaskSchema);
