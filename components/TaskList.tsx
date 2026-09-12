"use client";

import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { TaskRow, type RowTask } from "./TaskRow";

export interface ScheduleInfo {
  label?: string;
  overdueRisk: boolean;
}

export function TaskList<T extends RowTask>({
  tasks,
  tz,
  info,
  onReorder,
  onRename,
  onEstimate,
  onDeadline,
  onDone,
  onDelete,
}: {
  tasks: T[];
  tz: string;
  info: Record<string, ScheduleInfo>;
  onReorder: (ordered: T[]) => void;
  onRename: (id: string, title: string) => void;
  onEstimate: (id: string, minutes: number) => void;
  onDeadline: (id: string, dateStr: string | null) => void;
  onDone: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const sensors = useSensors(
    // desktop: small drag threshold so a click still works
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    // touch: press-and-hold briefly to start dragging, so normal swipes still scroll
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = tasks.findIndex((t) => t.id === active.id);
    const newIndex = tasks.findIndex((t) => t.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    onReorder(arrayMove(tasks, oldIndex, newIndex));
  }

  if (tasks.length === 0) {
    return <p className="px-1 py-8 text-center text-sm text-neutral-400">No tasks yet. Add one above.</p>;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <ul className="space-y-2">
          {tasks.map((t) => (
            <TaskRow
              key={t.id}
              task={t}
              tz={tz}
              scheduledLabel={info[t.id]?.label}
              overdueRisk={info[t.id]?.overdueRisk ?? false}
              onRename={(title) => onRename(t.id, title)}
              onEstimate={(m) => onEstimate(t.id, m)}
              onDeadline={(d) => onDeadline(t.id, d)}
              onDone={() => onDone(t.id)}
              onDelete={() => onDelete(t.id)}
            />
          ))}
        </ul>
      </SortableContext>
    </DndContext>
  );
}
