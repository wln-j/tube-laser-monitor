import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient('https://utuctkmiptbfwqkdxfqx.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0dWN0a21pcHRiZndxa2R4ZnF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0NzE4ODIsImV4cCI6MjA3OTA0Nzg4Mn0.02h44QACi-_KUEvHckQwigE3v_RV_zfM0Ihf6JJNiDQ')

const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;
const MS_PER_MINUTE = 60000;

let intervalId = null;
let realtimeChannel = null;
let viewedDate = localDateStr(new Date()); // 'YYYY-MM-DD'

function localDateStr(d) { return d.toLocaleDateString('en-CA'); }
function isToday(dateStr) { return dateStr === localDateStr(new Date()); }

window.onload = () => {
    const urlParams = new URLSearchParams(window.location.search);
    viewedDate = urlParams.get('date') || localDateStr(new Date());
    setupDateNav();
    setupTimelineGestures();
    refreshDateNav();
    fetchData();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) fetchData();
    });
};

async function fetchData() {
    const dateParam = viewedDate;
    const today = isToday(dateParam);
    const startOfDay = new Date(`${dateParam}T00:00:00`);
    const endOfDay = new Date(`${dateParam}T23:59:59.999`);

    if (realtimeChannel) {
        await supabase.removeChannel(realtimeChannel);
        realtimeChannel = null;
    }
    if (intervalId) { clearInterval(intervalId); intervalId = null; }

    const { data } = await supabase
        .from('events')
        .select('state, time')
        .gte('time', startOfDay.toISOString())
        .lt('time', endOfDay.toISOString());

    const events = data || [];

    // Live updates only matter for today; past days are settled history.
    if (today) {
        realtimeChannel = supabase.channel('custom-insert-channel')
            .on(
                'postgres_changes',
                { event: 'INSERT', schema: 'public', table: 'events' },
                (payload) => {
                    const payloadTime = new Date(payload.new.time);
                    if (payloadTime >= startOfDay && payloadTime < endOfDay) {
                        events.push(payload.new);
                        renderPage(events, startOfDay, endOfDay, true);
                    }
                }
            )
            .subscribe();
    }

    renderPage(events, startOfDay, endOfDay, today);
}

function renderPage(events, startOfDay, endOfDay, today) {
    if (intervalId) { clearInterval(intervalId); intervalId = null; }

    const timeline = document.getElementById("timeline");
    const statusColor = document.getElementById("status-color");

    positionNowMarker(today, startOfDay);

    if (events.length === 0) {
        timeline.innerHTML = "";
        statusColor.classList.remove("running");
        updateRunningTime(0);
        setCurrentRun(false);
        setFooter(today, null, null);
        return;
    }

    const df = document.createDocumentFragment();
    // Running state is live only for today; a past day has ended, so it reads stopped.
    const running = today && events[events.length - 1].state;

    let completedTime = 0;
    let currentDuration = 0;
    let firstStart = null;
    let lastStop = null;
    let openStart = null;   // start of an in-progress run (today)

    if (!events[0].state) {
        const duration = new Date(events[0].time) - startOfDay;
        df.appendChild(createEventElement(duration, 0, startOfDay, new Date(events[0].time), false));
        completedTime += duration;
    }

    for (let i = 0; i <= events.length - 1; i++) {
        const event = events[i];
        if (event.state) {
            const nextEvent = events[i + 1];
            const eventStart = new Date(event.time);
            // An open final segment runs to "now" today, but only to end-of-day for a past date.
            const isOpen = !nextEvent && today;
            const eventEnd = nextEvent ? new Date(nextEvent.time) : (today ? new Date() : endOfDay);
            const duration = eventEnd - eventStart;
            const offset = eventStart - startOfDay;

            df.appendChild(createEventElement(duration, offset, eventStart, eventEnd, isOpen));

            if (firstStart === null) firstStart = eventStart;
            lastStop = eventEnd;

            if (nextEvent) {
                completedTime += duration;
            } else {
                currentDuration = duration;
                if (today) openStart = eventStart;
            }
        }
    }

    timeline.innerHTML = "";
    timeline.appendChild(df);
    statusColor.classList.toggle("running", running);
    updateRunningTime(completedTime + currentDuration);
    setCurrentRun(running && openStart ? openStart : false);
    setFooter(today, firstStart, lastStop);

    if (running) {
        const runningEventTime = new Date(events[events.length - 1].time);
        const lastElement = timeline.lastElementChild;
        intervalId = setInterval(() => {
            updatePage(completedTime, runningEventTime, lastElement);
        }, 1000);
    }
}

function createEventElement(duration, offset, startDate, endDate, isOpen) {
    const newStatus = document.createElement("div");
    newStatus.className = "status-change running-status";
    newStatus.style.width = `${(duration / MS_PER_DAY) * 100}%`;
    newStatus.style.left = `${(offset / MS_PER_DAY) * 100}%`;
    newStatus._start = startDate;
    newStatus._end = endDate;
    newStatus._open = !!isOpen;
    return newStatus;
}

function updatePage(completedTime, runningEventTime, lastElement) {
    const duration = new Date() - runningEventTime;
    lastElement.style.width = `${(duration / MS_PER_DAY) * 100}%`;

    updateRunningTime(completedTime + duration);
    updateTimestamp();
    positionNowMarker(true, new Date(localDateStr(new Date()) + "T00:00:00"));
    setCurrentRun(runningEventTime);
}

// ---- now marker: a line at the current time of day (today only) ----
function positionNowMarker(today, startOfDay) {
    const el = document.getElementById("now-marker");
    if (!today) { el.classList.add("hidden"); return; }
    const frac = (new Date() - startOfDay) / MS_PER_DAY;
    el.style.left = `${frac * 100}%`;
    el.classList.remove("hidden");
}

// ---- current-run timer: how long the in-progress run has lasted ----
function setCurrentRun(startDate) {
    const wrap = document.getElementById("current-run");
    if (!startDate) { wrap.classList.add("hidden"); return; }
    const ms = new Date() - startDate;
    document.getElementById("current-run-val").textContent = formatDuration(ms);
    wrap.classList.remove("hidden");
}

function formatDuration(ms) {
    if (ms < MS_PER_MINUTE) return "0m";
    const hours = Math.floor(ms / MS_PER_HOUR);
    const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
    return (hours > 0 ? hours + "h " : "") + minutes + "m";
}

function updateRunningTime(milliseconds) {
    if (milliseconds < MS_PER_MINUTE) {
        document.getElementById("running-time").textContent = "0m";
        return;
    }

    const hours = Math.floor(milliseconds / MS_PER_HOUR);
    const minutes = Math.floor((milliseconds % MS_PER_HOUR) / MS_PER_MINUTE);
    const parts = [];

    if (hours > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);

    document.getElementById("running-time").textContent = parts.join(" ");
}

// Today -> "Updated 7:33 PM" (freshness). Past day -> active window "8:30a–6:03p".
function setFooter(today, firstStart, lastStop) {
    const el = document.getElementById("timestamp");
    if (today) {
        updateTimestamp();
    } else if (firstStart && lastStop) {
        el.textContent = fmtClock(firstStart) + "\u2013" + fmtClock(lastStop);
    } else {
        el.textContent = "No activity";
    }
}

function updateTimestamp() {
    const formattedDate = new Date().toLocaleTimeString([], {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
    });
    document.getElementById("timestamp").textContent = "Updated " + formattedDate;
}

function fmtClock(date) {
    return date
        .toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
        .replace(' AM', 'a')
        .replace(' PM', 'p');
}

/* ---------- date navigation ---------- */

function setupDateNav() {
    const prev = document.getElementById("prev-day");
    const next = document.getElementById("next-day");
    const input = document.getElementById("date-input");

    input.max = localDateStr(new Date());

    prev.addEventListener('click', () => { viewedDate = shiftDate(viewedDate, -1); commitDate(); });
    next.addEventListener('click', () => {
        if (!isToday(viewedDate)) { viewedDate = shiftDate(viewedDate, 1); commitDate(); }
    });
    input.addEventListener('change', () => {
        if (input.value) { viewedDate = input.value; commitDate(); }
    });
}

function commitDate() {
    refreshDateNav();
    const url = new URL(window.location);
    if (isToday(viewedDate)) url.searchParams.delete('date');
    else url.searchParams.set('date', viewedDate);
    history.replaceState(null, '', url);
    fetchData();
}

function refreshDateNav() {
    const todayView = isToday(viewedDate);
    document.getElementById("date-text").textContent = todayView ? "Today" : labelFor(viewedDate);
    document.getElementById("date-input").value = viewedDate;
    document.getElementById("next-day").disabled = todayView;
}

function shiftDate(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00`);
    d.setDate(d.getDate() + days);
    const result = localDateStr(d);
    const todayStr = localDateStr(new Date());
    return result > todayStr ? todayStr : result;
}

function labelFor(dateStr) {
    return new Date(`${dateStr}T00:00:00`)
        .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

/* ---------- timeline gestures ---------- */

function fmtClockDec(hoursDecimal) {
    const h = ((hoursDecimal % 24) + 24) % 24;
    let hr = Math.floor(h);
    let mn = Math.round((h - hr) * 60);
    if (mn === 60) { hr = (hr + 1) % 24; mn = 0; }
    const ap = hr >= 12 ? 'p' : 'a';
    const hh = hr % 12 || 12;
    return hh + ':' + String(mn).padStart(2, '0') + ap;
}

function setupTimelineGestures() {
    const container = document.getElementById("timeline-container");
    const scrubber = document.getElementById("scrubber");
    const scrubTime = document.getElementById("scrub-time");
    const pop = document.getElementById("bar-pop");

    let holdTimer = null;
    let scrubbing = false;
    let downX = 0;
    let downedBar = null;
    let popTimer = null;

    const HOLD_MS = 180;
    const MOVE_TOL = 6;

    function frac(clientX) {
        const r = container.getBoundingClientRect();
        return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    }
    function showScrub(clientX) {
        const f = frac(clientX);
        scrubber.style.left = (f * 100) + '%';
        scrubTime.textContent = fmtClockDec(f * 24);
        scrubber.classList.remove("hidden");
    }
    function hidePop() { pop.classList.remove("show"); }
    function showBarDetail(bar) {
        const start = fmtClockDecFromDate(bar._start);
        const end = bar._open ? "now" : fmtClockDecFromDate(bar._end);
        const dur = formatDuration(bar._end - bar._start);
        pop.innerHTML = start + "\u2013" + end + '<span class="mono">' + dur + '</span>';
        const left = parseFloat(bar.style.left) + parseFloat(bar.style.width) / 2;
        pop.style.left = left + '%';
        pop.classList.add("show");
        clearTimeout(popTimer);
        popTimer = setTimeout(hidePop, 2600);
    }
    function fmtClockDecFromDate(d) {
        return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })
                .replace(' AM', 'a').replace(' PM', 'p');
    }

    container.addEventListener("pointerdown", (e) => {
        downX = e.clientX;
        scrubbing = false;
        hidePop();
        downedBar = e.target.closest(".status-change");
        try { container.setPointerCapture(e.pointerId); } catch (_) {}
        holdTimer = setTimeout(() => { scrubbing = true; showScrub(e.clientX); }, HOLD_MS);
    });
    container.addEventListener("pointermove", (e) => {
        if (!scrubbing && Math.abs(e.clientX - downX) > MOVE_TOL) {
            scrubbing = true;
            clearTimeout(holdTimer);
        }
        if (scrubbing) showScrub(e.clientX);
    });
    function end() {
        clearTimeout(holdTimer);
        if (scrubbing) {
            scrubber.classList.add("hidden");
            scrubbing = false;
        } else if (downedBar) {
            showBarDetail(downedBar);
        }
        downedBar = null;
    }
    container.addEventListener("pointerup", end);
    container.addEventListener("pointercancel", () => {
        clearTimeout(holdTimer);
        scrubber.classList.add("hidden");
        scrubbing = false;
        downedBar = null;
    });
}
