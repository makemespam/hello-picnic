'use client';

// Day-assignment picker (docs/workpackages/WP-12-google-calendar.md §3: "per meal a
// day-picker (Sheet or select with next-7-days) writing cook_date"). A plain `<select>`
// keeps this simple (per the WP's own "keep simple" guidance for the assistive
// availability feature) — the next 7 days from today, each optionally hinted "druk"
// when calendarService.getFreeBusyHints flagged that evening as busy (§4).
import { Select } from '@/components/Select';

export interface DayOption {
  dateKey: string;
  label: string;
  busy: boolean;
}

export interface DayPickerProps {
  id: string;
  value: string | null;
  options: DayOption[];
  disabled?: boolean;
  onChange: (dateKey: string | null) => void;
}

export function DayPicker({ id, value, options, disabled, onChange }: DayPickerProps) {
  return (
    <Select
      id={id}
      aria-label="Kookdag"
      value={value ?? ''}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value === '' ? null : event.target.value)}
    >
      <option value="">Geen dag gekozen</option>
      {options.map((option) => (
        <option key={option.dateKey} value={option.dateKey}>
          {option.label}
          {option.busy ? ' — druk' : ''}
        </option>
      ))}
    </Select>
  );
}
