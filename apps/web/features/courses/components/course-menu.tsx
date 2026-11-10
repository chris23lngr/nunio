import { Button } from "@nunio/ui/components/button/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@nunio/ui/components/dropdown-menu/dropdown-menu";
import {
  Archive,
  ArchiveRestore,
  EllipsisVertical,
  Pencil,
  ThumbsDown,
  Trash2,
} from "lucide-react";
import type { CourseSummary } from "../api/course-queries";

export type CourseAction =
  | "edit"
  | "archive"
  | "unarchive"
  | "reject"
  | "delete";

/** A Course's actions. Only a Course nunio proposed can be rejected; the student's own can only be deleted. */
export function CourseMenu({
  course,
  onAction,
}: {
  course: CourseSummary;
  onAction: (action: CourseAction) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Aktionen für ${course.title}`}
          />
        }
      >
        <EllipsisVertical aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => onAction("edit")}>
            <Pencil aria-hidden="true" />
            Bearbeiten
          </DropdownMenuItem>
          {course.archived ? (
            <DropdownMenuItem onClick={() => onAction("unarchive")}>
              <ArchiveRestore aria-hidden="true" />
              Archivierung aufheben
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => onAction("archive")}>
              <Archive aria-hidden="true" />
              Archivieren
            </DropdownMenuItem>
          )}
          {!course.entered && (
            <DropdownMenuItem onClick={() => onAction("reject")}>
              <ThumbsDown aria-hidden="true" />
              Ablehnen
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            className="text-destructive-700 [&_svg]:text-destructive-500"
            onClick={() => onAction("delete")}
          >
            <Trash2 aria-hidden="true" />
            Löschen
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
