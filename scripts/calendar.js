(() => {
  function pad(value) {
    return String(value).padStart(2, "0");
  }

  function formatUtcTimestamp(date) {
    return (
      date.getUTCFullYear() +
      pad(date.getUTCMonth() + 1) +
      pad(date.getUTCDate()) +
      "T" +
      pad(date.getUTCHours()) +
      pad(date.getUTCMinutes()) +
      pad(date.getUTCSeconds()) +
      "Z"
    );
  }

  function formatLocalTimestamp(date) {
    return (
      date.getFullYear() +
      pad(date.getMonth() + 1) +
      pad(date.getDate()) +
      "T" +
      pad(date.getHours()) +
      pad(date.getMinutes()) +
      pad(date.getSeconds())
    );
  }

  function escapeIcsText(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function slugifyFilename(value) {
    return String(value || "event")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "event";
  }

  function buildIcsContent(options) {
    const now = new Date();
    const uid = `${Date.now()}-${Math.random().toString(36).slice(2)}@phreaking.collective`;

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "PRODID:-//Phreaking Collective//Events//EN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${formatUtcTimestamp(now)}`,
      `SUMMARY:${escapeIcsText(options.summary)}`,
      `LOCATION:${escapeIcsText(options.location)}`,
      `DTSTART;TZID=${options.timezone}:${formatLocalTimestamp(options.startDate)}`,
      `DTEND;TZID=${options.timezone}:${formatLocalTimestamp(options.endDate)}`,
      "END:VEVENT",
      "END:VCALENDAR",
    ];

    return lines.join("\r\n");
  }

  function downloadIcs(icsContent, filename) {
    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Let the browser finish the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  function handleAddToCalendarClick(event) {
    const button = event.currentTarget;
    const summary = button.dataset.summary || "Event";
    const location = button.dataset.location || "";
    const timezone = button.dataset.timezone || "UTC";
    const startRaw = button.dataset.start;
    const endRaw = button.dataset.end;

    if (!startRaw || !endRaw) {
      console.error("Missing data-start or data-end for calendar event.");
      return;
    }

    const startDate = new Date(startRaw);
    const endDate = new Date(endRaw);

    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      console.error("Invalid calendar date format. Use ISO date strings in data-start/data-end.");
      return;
    }

    const icsContent = buildIcsContent({
      summary,
      location,
      timezone,
      startDate,
      endDate,
    });

    const filename = `${slugifyFilename(summary)}.ics`;
    downloadIcs(icsContent, filename);
  }

  const addCalButton = document.getElementById("addCal");
  if (addCalButton) {
    addCalButton.addEventListener("click", handleAddToCalendarClick);
  }
})();
