"use client";

import { useEffect, useRef, useState } from "react";

import type { AttendanceMatrix, MatrixCell, MatrixDay, MatrixEmployee } from "../../lib/attendance/matrix";
import { loadAttendanceMatrixAction, markAttendanceCellAction } from "../attendance/actions";
import { FormDialog } from "./form-dialog";
import { SkeletonTable } from "./skeleton";
import { useToast } from "./toast";

/**
 * The marks a firm actually uses day to day, in the order someone reaching for
 * them expects. The letter is what gets typed and what shows in the cell.
 */
const MARKS = [
  { key: "p", label: "Present", status: "present", letter: "P" },
  { key: "a", label: "Absent", status: "absent", letter: "A" },
  { key: "l", label: "Leave", status: "leave", letter: "L" },
  { key: "h", label: "Half day", status: "half_day", letter: "H" },
  { key: "w", label: "Work from home", status: "wfh", letter: "W" },
  { key: "t", label: "Client duty", status: "tour", letter: "T" },
] as const;

const LETTERS: Record<string, string> = {
  absent: "A", half_day: "H", holiday: "—", late: "P", leave: "L",
  missing_punch: "!", present: "P", tour: "T", weekly_off: "·", wfh: "W",
};

const STATUS_LABELS: Record<string, string> = {
  absent: "Absent", half_day: "Half day", holiday: "Holiday", late: "Present (late)",
  leave: "On leave", missing_punch: "Missing punch", present: "Present", tour: "Client duty",
  weekly_off: "Weekly off", wfh: "Work from home",
};

/** Times come back as instants; the register is read in India. */
const timeValue = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, minute: "2-digit", timeZone: "Asia/Kolkata" }).format(new Date(iso)) : "";

type OpenCell = { date: string; employee: MatrixEmployee };

export function AttendanceMatrixGrid({ periodKey }: { periodKey: string }) {
  const toast = useToast();
  const [matrix, setMatrix] = useState<AttendanceMatrix | null>(null);
  const [failed, setFailed] = useState(false);
  const [openCell, setOpenCell] = useState<OpenCell | null>(null);
  const [saving, setSaving] = useState(false);
  const reload = useRef(0);

  useEffect(() => {
    const ticket = (reload.current += 1);
    let cancelled = false;
    loadAttendanceMatrixAction(periodKey)
      .then((data) => { if (!cancelled && reload.current === ticket) { setMatrix(data); setFailed(false); } })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [periodKey]);

  const refresh = () => {
    const ticket = (reload.current += 1);
    loadAttendanceMatrixAction(periodKey)
      .then((data) => { if (reload.current === ticket) setMatrix(data); })
      .catch(() => setFailed(true));
  };

  if (failed) {
    return (
      <p className="form-dialog-status is-error" role="alert">
        The attendance grid could not be loaded.{" "}
        <button className="master-toggle-button" onClick={() => { setFailed(false); refresh(); }} type="button">Try again</button>
      </p>
    );
  }
  if (!matrix) return <SkeletonTable columns={8} rows={6} />;

  const current = openCell ? openCell.employee.cells[openCell.date] ?? null : null;

  return (
    <section aria-label="Monthly attendance grid" className="attendance-matrix surface-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">MONTH TIMELINE</p>
          <h2>Mark attendance</h2>
          <span>{matrix.employees.length} employees · {matrix.days.length} days · click any cell to set status and times</span>
        </div>
      </div>

      <div className="attendance-matrix-legend">
        {MARKS.map((mark) => (
          <span className={`attendance-mark is-${mark.status}`} key={mark.key}>
            <i>{mark.letter}</i>{mark.label}
          </span>
        ))}
        {matrix.locked && <strong className="attendance-matrix-locked">Month locked — reopen it to make changes</strong>}
      </div>

      <div className="attendance-matrix-scroll">
        <table className="attendance-matrix-table">
          <caption className="sr-only">Attendance for {matrix.periodKey}. Each cell is a button that opens the entry for that employee and date.</caption>
          <thead>
            <tr>
              <th className="attendance-matrix-name" scope="col">Employee</th>
              {matrix.days.map((day) => (
                <th
                  className={`attendance-matrix-day ${day.isWeeklyOff ? "is-off" : ""} ${day.holidayName ? "is-holiday" : ""} ${day.isToday ? "is-today" : ""}`}
                  key={day.date}
                  scope="col"
                  title={day.holidayName ?? undefined}
                >
                  <span>{day.dayOfMonth}</span>
                  <small>{day.weekday}</small>
                </th>
              ))}
              <th className="attendance-matrix-total" scope="col">P / A / L</th>
            </tr>
          </thead>
          <tbody>
            {matrix.employees.map((employee) => (
              <tr key={employee.userId}>
                <th className="attendance-matrix-name" scope="row">
                  <strong>{employee.fullName}</strong>
                  <small>{employee.employeeCode} · {employee.designation}</small>
                </th>
                {matrix.days.map((day) => (
                  <MatrixCellButton
                    cell={employee.cells[day.date]}
                    day={day}
                    employee={employee}
                    key={day.date}
                    locked={matrix.locked}
                    onOpen={() => setOpenCell({ date: day.date, employee })}
                  />
                ))}
                <td className="attendance-matrix-total">
                  <b>{employee.totals.present}</b> / <i>{employee.totals.absent}</i> / <em>{employee.totals.leave}</em>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!matrix.employees.length && <p className="global-search-empty">No employees are on the payroll for {matrix.periodKey}.</p>}
      </div>

      <MarkDialog
        cell={current}
        date={openCell?.date ?? ""}
        employee={openCell?.employee ?? null}
        onClose={() => setOpenCell(null)}
        onSave={async (values) => {
          if (!openCell) return;
          setSaving(true);
          const result = await markAttendanceCellAction({
            attendanceDate: openCell.date,
            checkInTime: values.checkInTime,
            checkOutTime: values.checkOutTime,
            employeeUserId: openCell.employee.userId,
            note: values.note,
            status: values.status,
          });
          setSaving(false);
          if (result.error) {
            toast.error(result.error);
            return;
          }
          toast.success(`${openCell.employee.fullName} · ${STATUS_LABELS[values.status] ?? values.status} on ${openCell.date}`);
          setOpenCell(null);
          refresh();
        }}
        saving={saving}
      />
    </section>
  );
}

function MatrixCellButton({
  cell,
  day,
  employee,
  locked,
  onOpen,
}: {
  cell?: MatrixCell;
  day: MatrixDay;
  employee: MatrixEmployee;
  locked: boolean;
  onOpen: () => void;
}) {
  const status = cell?.status ?? (day.holidayName ? "holiday" : day.isWeeklyOff ? "weekly_off" : "");
  const described = cell
    ? `${STATUS_LABELS[cell.status] ?? cell.status}${cell.checkIn ? `, in ${timeValue(cell.checkIn)}` : ""}${cell.checkOut ? `, out ${timeValue(cell.checkOut)}` : ""}`
    : day.holidayName ? `Holiday: ${day.holidayName}` : day.isWeeklyOff ? "Weekly off" : "Not marked";

  return (
    <td className="attendance-matrix-cell">
      <button
        // The name and date are in the label because the column header alone
        // does not tell a screen-reader user which row they are in.
        aria-label={`${employee.fullName}, ${day.date}: ${described}`}
        className={`attendance-cell-button is-${status || "empty"} ${day.isToday ? "is-today" : ""}`}
        disabled={locked}
        onClick={onOpen}
        type="button"
      >
        {status ? LETTERS[status] ?? "?" : ""}
      </button>
    </td>
  );
}

function MarkDialog({
  cell,
  date,
  employee,
  onClose,
  onSave,
  saving,
}: {
  cell: MatrixCell | null;
  date: string;
  employee: MatrixEmployee | null;
  onClose: () => void;
  onSave: (values: { checkInTime: string; checkOutTime: string; note: string; status: string }) => void;
  saving: boolean;
}) {
  const [status, setStatus] = useState("present");
  const [checkInTime, setCheckInTime] = useState("");
  const [checkOutTime, setCheckOutTime] = useState("");
  const [note, setNote] = useState("");
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Adopt whatever is already recorded when the dialog moves to a new cell.
  const cellKey = employee ? `${employee.userId}:${date}` : null;
  if (cellKey && cellKey !== loadedFor) {
    setLoadedFor(cellKey);
    setStatus(cell?.status ?? "present");
    setCheckInTime(timeValue(cell?.checkIn ?? null));
    setCheckOutTime(timeValue(cell?.checkOut ?? null));
    setNote(cell?.note ?? "");
  }

  // A half day or an absence has no hours, so the time fields would only invite
  // a contradiction between the status and the clock.
  const timesApply = ["present", "late", "wfh", "tour", "half_day"].includes(status);

  return (
    <FormDialog
      description={employee ? `${employee.fullName} · ${date}` : ""}
      onClose={onClose}
      open={Boolean(employee)}
      title="Mark attendance"
    >
      <div className="attendance-mark-form">
        <fieldset className="attendance-mark-picker">
          <legend>Status</legend>
          {MARKS.map((mark) => (
            <button
              aria-pressed={status === mark.status}
              className={`attendance-mark-option is-${mark.status}`}
              key={mark.key}
              onClick={() => setStatus(mark.status)}
              type="button"
            >
              <i>{mark.letter}</i>
              <span>{mark.label}</span>
            </button>
          ))}
        </fieldset>

        <div className="attendance-mark-times">
          <label>
            <span>Check-in</span>
            <input disabled={!timesApply} onChange={(event) => setCheckInTime(event.target.value)} type="time" value={checkInTime} />
          </label>
          <label>
            <span>Check-out</span>
            <input disabled={!timesApply} onChange={(event) => setCheckOutTime(event.target.value)} type="time" value={checkOutTime} />
          </label>
        </div>

        <label className="attendance-mark-note">
          <span>Note</span>
          <input maxLength={500} onChange={(event) => setNote(event.target.value)} placeholder="Reason, approval reference, or context" value={note} />
        </label>

        <p className="attendance-mark-hint">Every entry is recorded against your name in the attendance audit trail.</p>
      </div>

      <div className="form-dialog-actions">
        <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
        <button
          className="primary-button"
          disabled={saving}
          onClick={() => onSave({
            checkInTime: timesApply ? checkInTime : "",
            checkOutTime: timesApply ? checkOutTime : "",
            note,
            status,
          })}
          type="button"
        >
          {saving ? "Saving…" : "Save entry"}
        </button>
      </div>
    </FormDialog>
  );
}
