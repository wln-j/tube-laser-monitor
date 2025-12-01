import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabase = createClient('https://utuctkmiptbfwqkdxfqx.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV0dWN0a21pcHRiZndxa2R4ZnF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM0NzE4ODIsImV4cCI6MjA3OTA0Nzg4Mn0.02h44QACi-_KUEvHckQwigE3v_RV_zfM0Ihf6JJNiDQ')

const MS_PER_DAY = 86400000;
const MS_PER_HOUR = 3600000;
const MS_PER_MINUTE = 60000;

let intervalId = null;
let realtimeChannel = null;
let previousDataLength = 0;

window.onload = () => {
    fetchData();
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
            fetchData();
        }
    });
}

async function fetchData() {
    const urlParams = new URLSearchParams(window.location.search);
    const getLocalDate = () => {
        const now = new Date();
        return now.toLocaleDateString('en-CA');
    };
    const dateParam = urlParams.get('date') || getLocalDate();
    const startOfDay = new Date(`${dateParam}T00:00:00`);
    const endOfDay = new Date(`${dateParam}T23:59:59.999`);

    if (realtimeChannel) {
        await supabase.removeChannel(realtimeChannel);
    }

    const { data } = await supabase
        .from('states')
        .select('state, time')
        .gte('time', startOfDay.toISOString())
        .lt('time', endOfDay.toISOString())

    realtimeChannel = supabase.channel('custom-insert-channel')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'states' },
            (payload) => {
                const payloadTime = new Date(payload.new.time);
                if (payloadTime >= startOfDay && payloadTime < endOfDay) {
                    data.push(payload.new)
                    previousDataLength = data.length;
                    renderPage(data, startOfDay);
                }
            }
        )
        .subscribe()

    if (data.length !== previousDataLength) {
        previousDataLength = data.length;
        renderPage(data, startOfDay);
    }
}

function renderPage(events, startOfDay) {
    if (events.length === 0) return;

    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }

    const timeline = document.getElementById("timeline");
    const df = document.createDocumentFragment();
    const running = events[events.length - 1].state;

    let completedTime = 0;
    let currentDuration = 0;

    if (!events[0].state) {
        const duration = new Date(events[0].time) - startOfDay;
        df.appendChild(createEventElement(duration, 0));
        completedTime += duration;
    }

    for (let i = 0; i <= events.length - 1; i++) {
        const event = events[i];
        if (event.state) {
            const nextEvent = events[i + 1]
            const eventStart = new Date(event.time);
            const eventEnd = nextEvent ? new Date(nextEvent.time) : new Date();
            const duration = eventEnd - eventStart;
            const offset = eventStart - startOfDay;

            df.appendChild(createEventElement(duration, offset))
            if (nextEvent) {
                completedTime += duration;
            } else {
                currentDuration = duration;
            }
        }
    }

    timeline.innerHTML = "";
    timeline.appendChild(df);
    document.getElementById("status-color").classList.toggle("running", running);
    updateRunningTime(completedTime + currentDuration);
    updateTimestamp();

    if (running) {
        const runningEventTime = new Date(events[events.length - 1].time)
        const lastElement = timeline.lastElementChild;
        intervalId = setInterval(() => {
            updatePage(completedTime, runningEventTime, lastElement);
        }, 1000);
    }
}

function createEventElement(duration, offset) {
    const newStatus = document.createElement("div");
    newStatus.className = "status-change running-status";
    newStatus.style.width = `${(duration / MS_PER_DAY) * 100}%`;
    newStatus.style.left = `${(offset / MS_PER_DAY) * 100}%`;
    return newStatus
}

function updatePage( completedTime, runningEventTime, lastElement) {
    const duration = new Date() - runningEventTime;
    lastElement.style.width = `${(duration / MS_PER_DAY) * 100}%`;

    updateRunningTime(completedTime + duration);
    updateTimestamp();
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

function updateTimestamp() {
    const currentDate = new Date();
    const formattedDate = currentDate.toLocaleTimeString([], {
        hour: 'numeric',
        minute: 'numeric',
        hour12: true
    });

  document.getElementById("timestamp").innerText = "Updated " + formattedDate;
}