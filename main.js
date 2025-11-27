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
    const startOfDay = `${dateParam}T00:00:00`;
    const endOfDay = `${dateParam}T23:59:59.999`;

    if (realtimeChannel) {
        await supabase.removeChannel(realtimeChannel);
    }

    const { data } = await supabase
        .from('states')
        .select('state, time')
        .gte('time', new Date(startOfDay).toISOString())
        .lt('time', new Date(endOfDay).toISOString())

    realtimeChannel = supabase.channel('custom-insert-channel')
        .on(
            'postgres_changes',
            { event: 'INSERT', schema: 'public', table: 'states' },
            (payload) => {
                if (payload.new.time >= startOfDay && payload.new.time < endOfDay) {
                    data.push(payload.new)
                    previousDataLength = data.length;
                    processEvents(data, new Date(startOfDay));
                }
            }
        )
        .subscribe()

    if (data.length !== previousDataLength) {
        previousDataLength = data.length;
        processEvents(data, new Date(startOfDay));
    }
}

function processEvents(data, startOfDay) {
    if (data.length === 0) return;

    if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
    }

    initPage(data, startOfDay);

    if (data[data.length - 1].state) {
        intervalId = setInterval(() => {
            updatePage(data, startOfDay);
        }, 1000);
    }
}

function initPage(data, startOfDay) {
    const timeline = document.getElementById("timeline");
    const df = document.createDocumentFragment();

    let runningTime = 0;

    if (!data[0].state) {
        const eventEnd = new Date(data[0].time)
        const duration = eventEnd - startOfDay;

        df.appendChild(createStatusBar(duration, 0))
        runningTime += duration;
    }

    for (let i = 0; i <= data.length - 1; i++) {
        const event = data[i];

        if (event.state) {
            const nextEvent = data[i + 1]
            const eventStart = new Date(event.time);
            const eventEnd = nextEvent ? new Date(nextEvent.time) : new Date();
            const duration = eventEnd - eventStart;
            const offset = eventStart - startOfDay;

            df.appendChild(createStatusBar(duration, offset))
            runningTime += duration;
        }
    }

    timeline.innerHTML = "";
    timeline.appendChild(df);

    document.getElementById("status-color").classList.toggle("running", data[data.length - 1].state);
    document.getElementById("running-time").innerHTML = formatTime(runningTime);
    updateTimestamp();
}

function updatePage(data, startOfDay) {
    const timeline = document.getElementById("timeline");

    let runningTime = 0;

    if (!data[0].state) {
        const eventEnd = new Date(data[0].time)
        const duration = eventEnd - startOfDay;
        runningTime += duration;
    }

    for (let i = 0; i <= data.length - 1; i++) {
        const event = data[i];

        if (event.state) {
            const nextEvent = data[i + 1]
            const eventStart = new Date(event.time);
            const eventEnd = nextEvent ? new Date(nextEvent.time) : new Date();
            const duration = eventEnd - eventStart;
            runningTime += duration;

            if (!nextEvent) {
                timeline.lastElementChild.style.width = `${(duration / MS_PER_DAY) * 100}%`;
            }
        }
    }

    document.getElementById("status-color").classList.toggle("running", data[data.length - 1].state);
    document.getElementById("running-time").innerHTML = formatTime(runningTime);
    updateTimestamp();
}

function createStatusBar(duration, offset) {
    const newStatus = document.createElement("div");
    newStatus.className = "status-change running-status";
    newStatus.style.width = `${(duration / MS_PER_DAY) * 100}%`;
    newStatus.style.left = `${(offset / MS_PER_DAY) * 100}%`;
    return newStatus;
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

function formatTime(milliseconds) {
    if (milliseconds < MS_PER_MINUTE) {
        return "<span class='time-total'>0</span><span>m</span>";
    }

    const hours = Math.floor(milliseconds / MS_PER_HOUR);
    const minutes = Math.floor((milliseconds % MS_PER_HOUR) / MS_PER_MINUTE);
    
    const parts = [];
  
    if (hours > 0) {
        parts.push(`<span class='time-total'>${hours}</span><span>h</span>`);
    }
  
    if (minutes > 0) {
        parts.push(`<span class='time-total'>${minutes}</span><span>m</span>`);
    }
  
    return parts.join(" ");
}