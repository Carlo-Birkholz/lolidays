// app.js
import 'dotenv/config';
import pkg from '@slack/bolt';
const { App } = pkg;
import express from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import db, {
  insertVacation,
  insertStop,
  getAllVacationsWithStops,
  getStopsForVacation,
  // add these:
  getStopsFlat,
  deleteStop
} from './db.js';
import { buildStaticMapUrl } from './staticMap.js';

const bolt = new App({
  token: process.env.SLACK_BOT_TOKEN,
  appToken: process.env.SLACK_APP_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true
});

const uid = () => crypto.randomUUID();

async function geocode(place) {
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(place)}.json?access_token=${process.env.MAPBOX_TOKEN}`;
  const res = await fetch(url);
  const j = await res.json();
  const feat = j?.features?.[0];
  return feat ? { lon: feat.center[0], lat: feat.center[1] } : { lon: null, lat: null };
}

// Slash command: /vacation
bolt.command('/vacation', async ({ ack, client, body, command }) => {
  await ack();
  const parts = (command.text || '').trim().split(/\s+/);
  const sub = (parts.shift() || '').toLowerCase();

  if (!sub || sub === 'new') {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'vacation_new',
        title: { type: 'plain_text', text: 'New Vacation' },
        submit: { type: 'plain_text', text: 'Create' },
        blocks: [
          { type: 'input', block_id: 'title', label: { type: 'plain_text', text: 'Title' },
            element: { type: 'plain_text_input', action_id: 't', placeholder: { type: 'plain_text', text: 'e.g., Norway: Oslo → Telemark' } } },
          { type: 'input', optional: true, block_id: 'dates', label: { type: 'plain_text', text: 'Start date' },
            element: { type: 'datepicker', action_id: 'start' } },
          { type: 'input', optional: true, block_id: 'dates2', label: { type: 'plain_text', text: 'End date' },
            element: { type: 'datepicker', action_id: 'end' } }
        ]
      }
    });
    return;
  }

  if (sub === 'addstop') {
    await client.views.open({
      trigger_id: body.trigger_id,
      view: {
        type: 'modal',
        callback_id: 'stop_add',
        title: { type: 'plain_text', text: 'Add Stop' },
        submit: { type: 'plain_text', text: 'Add' },
        blocks: [
          { type: 'input', block_id: 'vac', label: { type: 'plain_text', text: 'Vacation ID' },
            element: { type: 'plain_text_input', action_id: 'v' } },
          { type: 'input', block_id: 'name', label: { type: 'plain_text', text: 'Stop name' },
            element: { type: 'plain_text_input', action_id: 'n', placeholder: { type: 'plain_text', text: 'e.g., Oslo, Vollen, Telemark' } } },
          { type: 'input', optional: true, block_id: 'date', label: { type: 'plain_text', text: 'Date at stop' },
            element: { type: 'datepicker', action_id: 'd' } },
          { type: 'input', optional: true, block_id: 'album', label: { type: 'plain_text', text: 'Album URL (optional)' },
            element: { type: 'plain_text_input', action_id: 'a' } },
          { type: 'input', optional: true, block_id: 'idx', label: { type: 'plain_text', text: 'Order (leave blank to append)' },
            element: { type: 'plain_text_input', action_id: 'i' } }
        ]
      }
    });
    return;
  }

  if (sub === 'preview') {
    const vacationId = parts[0];
    if (!vacationId) {
      await client.chat.postEphemeral({
        channel: body.channel_id, user: body.user_id,
        text: 'Usage: `/vacation preview <vacation_id>`'
      });
      return;
    }
    const stops = getStopsForVacation.all(vacationId);
    if (!stops.length) {
      await client.chat.postEphemeral({
        channel: body.channel_id, user: body.user_id,
        text: `No stops found for vacation \`${vacationId}\`.`
      });
      return;
    }
    const imageUrl = buildStaticMapUrl(stops);
    const mapLink = process.env.PUBLIC_MAP_URL || `http://localhost:${process.env.PORT}`;
    await client.chat.postMessage({
      channel: body.channel_id,
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text: `*Lolidays — Route preview*\nVacation: \`${vacationId}\`` } },
        { type: 'image', image_url: imageUrl, alt_text: 'Trip route preview' },
        { type: 'actions', elements: [
          { type: 'button', text: { type: 'plain_text', text: 'Open interactive map' }, url: mapLink }
        ]}
      ]
    });
    return;
  }

  if (sub === 'map') {
    await client.chat.postEphemeral({
      channel: body.channel_id, user: body.user_id,
      text: `Open the interactive map: ${process.env.PUBLIC_MAP_URL || `http://localhost:${process.env.PORT}`}`
    });
    return;
  }
  
  if (sub === 'liststops') {
  const vacationId = parts[0];
  if (!vacationId) {
    await client.chat.postEphemeral({
      channel: body.channel_id, user: body.user_id,
      text: 'Usage: `/vacation liststops <vacation_id>`'
    });
    return;
  }

  // get the stops and print their IDs so you can delete the right one
  const stops = getStopsFlat.all(vacationId);
  if (!stops.length) {
    await client.chat.postEphemeral({
      channel: body.channel_id, user: body.user_id,
      text: `No stops found for vacation \`${vacationId}\`.`
    });
    return;
  }

  const lines = stops.map((s, i) =>
    `${i+1}. ${s.name}` + (s.date ? ` (${s.date})` : '') + ` — stop_id: \`${s.id}\`, idx: ${s.idx}`
  ).join('\n');

  await client.chat.postEphemeral({
    channel: body.channel_id, user: body.user_id,
    text: `Stops for \`${vacationId}\`:\n${lines}`
  });
  return;
}

if (sub === 'removestop') {
  const stopId = parts[0];
  if (!stopId) {
    await client.chat.postEphemeral({
      channel: body.channel_id, user: body.user_id,
      text: 'Usage: `/vacation removestop <stop_id>`'
    });
    return;
  }

  const info = deleteStop.run(stopId);
  if (info.changes === 0) {
    await client.chat.postEphemeral({
      channel: body.channel_id, user: body.user_id,
      text: `No stop found with id \`${stopId}\`.`
    });
    return;
  }

  await client.chat.postEphemeral({
    channel: body.channel_id, user: body.user_id,
    text: `🗑️ Removed stop \`${stopId}\`.`
  });
  return;
}

  // Unknown subcommand help
  await client.chat.postEphemeral({
    channel: body.channel_id, user: body.user_id,
    text: 'Try `/vacation new`, `/vacation addstop`, `/vacation preview <id>`, or `/vacation map`.'
  });
});

// Vacation created
bolt.view('vacation_new', async ({ ack, body, view, client }) => {
  await ack();
  const title = view.state.values.title.t.value.trim();
  const start = view.state.values.dates?.start?.selected_date || null;
  const end = view.state.values.dates2?.end?.selected_date || null;
  const id = uid();

  insertVacation.run({ id, title, start_date: start, end_date: end, created_by: body.user.id });

  const dm = await client.conversations.open({ users: body.user.id });
  await client.chat.postMessage({
    channel: dm.channel.id,
    text: `✅ Vacation created: *${title}* (ID: \`${id}\`). Use */vacation addstop* to add stops.`
  });

  await publishHome(client, body.user.id);
});

// Stop added (with DM preview)
bolt.view('stop_add', async ({ ack, body, view, client }) => {
  await ack();
  const vacation_id = view.state.values.vac.v.value.trim();
  const name = view.state.values.name.n.value.trim();
  const date = view.state.values.date?.d?.selected_date || null;
  const album_url = view.state.values.album?.a?.value || null;
  const idxText = view.state.values.idx?.i?.value || '';
  const idx = idxText ? parseInt(idxText, 10) : 9999;

  const { lat, lon } = await geocode(name);
  insertStop.run({ id: uid(), vacation_id, name, date, album_url, lat, lon, idx });

  const dm = await client.conversations.open({ users: body.user.id });
  const stops = getStopsForVacation.all(vacation_id);
  const imageUrl = buildStaticMapUrl(stops);

  // ✅ fallback: PUBLIC_MAP_URL or localhost
  const mapLink = process.env.PUBLIC_MAP_URL || `http://localhost:${process.env.PORT}`;

  await client.chat.postMessage({
    channel: dm.channel.id,
    text: `📍 Added stop *${name}* to \`${vacation_id}\`.`,
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: `📍 Added *${name}* to \`${vacation_id}\`.` } },
      { type: 'image', image_url: imageUrl, alt_text: 'Updated route preview' },
      { type: 'actions', elements: [
        { type: 'button', text: { type: 'plain_text', text: 'Open interactive map' }, url: mapLink }
      ]}
    ]
  });

  await publishHome(client, body.user.id);
});

// Home tab
async function publishHome(client, user) {
  const vacations = getAllVacationsWithStops();
  const blocks = [
    { type: 'header', text: { type: 'plain_text', text: 'Lolidays — Family Routes' } },
    { type: 'section', text: { type: 'mrkdwn', text: `Open map → ${process.env.PUBLIC_MAP_URL || `http://localhost:${process.env.PORT}`}` } },
    { type: 'divider' }
  ];
  vacations.forEach(v => {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn',
        text: `*${v.title}*  (${v.start_date ?? '—'} → ${v.end_date ?? '—'})\nID: \`${v.id}\`\n${v.stops.length} stops`
      },
      accessory: { type: 'button', text: { type: 'plain_text', text: 'Add stop' }, value: v.id, action_id: 'open_addstop' }
    });
  });
  await client.views.publish({ user_id: user, view: { type: 'home', blocks } });
}

bolt.action('open_addstop', async ({ ack, body, client }) => {
  await ack();
  const vacationId = body.actions?.[0]?.value;
  await client.views.open({
    trigger_id: body.trigger_id,
    view: {
      type: 'modal',
      callback_id: 'stop_add',
      title: { type: 'plain_text', text: 'Add Stop' },
      submit: { type: 'plain_text', text: 'Add' },
      blocks: [
        { type: 'input', block_id: 'vac', label: { type: 'plain_text', text: 'Vacation ID' },
          element: { type: 'plain_text_input', action_id: 'v', initial_value: vacationId } },
        { type: 'input', block_id: 'name', label: { type: 'plain_text', text: 'Stop name' },
          element: { type: 'plain_text_input', action_id: 'n' } },
        { type: 'input', optional: true, block_id: 'date', label: { type: 'plain_text', text: 'Date at stop' },
          element: { type: 'datepicker', action_id: 'd' } },
        { type: 'input', optional: true, block_id: 'album', label: { type: 'plain_text', text: 'Album URL (optional)' },
          element: { type: 'plain_text_input', action_id: 'a' } },
        { type: 'input', optional: true, block_id: 'idx', label: { type: 'plain_text', text: 'Order (leave blank to append)' },
          element: { type: 'plain_text_input', action_id: 'i' } }
      ]
    }
  });
});

// Web server: interactive map + API
const web = express();

// quick health endpoint to "wake" a sleeping free instance
web.get('/ping', (_, res) => res.type('text').send('ok'));

web.get('/', (_, res) => {
  res.send(`<!doctype html>
<html><head>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Lolidays — Family Routes</title>
  <link href="https://api.mapbox.com/mapbox-gl-js/v3.14.0/mapbox-gl.css" rel="stylesheet">
  <style>
    html,body,#map{height:100%;margin:0}
    .pin{font:12px/1.2 system-ui;background:#fff;padding:6px 8px;border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,.2)}
    .seq{display:inline-block;width:18px;height:18px;border-radius:50%;text-align:center;line-height:18px;font-weight:700;margin-right:6px;background:#000;color:#fff}
    .legend{position:absolute;left:10px;top:10px;background:#fff;padding:8px 10px;border-radius:8px;box-shadow:0 1px 6px rgba(0,0,0,.2);max-width:320px}
    .legend h2{margin:0 0 6px 0;font:600 14px system-ui}
    .legend a{word-break:break-all}
  </style>
</head>
<body>
  <div id="map"></div>
  <div class="legend" id="legend"></div>
  <script src="https://api.mapbox.com/mapbox-gl-js/v3.14.0/mapbox-gl.js"></script>
  <script>
    mapboxgl.accessToken = '${process.env.MAPBOX_TOKEN}';
    const map = new mapboxgl.Map({ container: 'map', style: 'mapbox://styles/mapbox/standard', center: [10,51], zoom: 4 });

    async function loadData(){ const res = await fetch('/api/v1/vacations'); return res.json(); }

    map.on('load', async () => {
      const data = await loadData(); // { vacations: [...] }
      const bounds = new mapboxgl.LngLatBounds();
      const legend = document.getElementById('legend');
      legend.innerHTML = '<h2>Vacations</h2>';

      data.vacations.forEach((v) => {
        const coords = [];
        v.stops.sort((a,b) => a.idx - b.idx).forEach((s, i) => {
          if (s.lon == null || s.lat == null) return;
          const c = [s.lon, s.lat]; coords.push(c); bounds.extend(c);

          const el = document.createElement('div');
          el.className = 'pin';
          el.innerHTML = '<span class="seq">'+(i+1)+'</span>' + s.name + (s.date ? ('<br><small>'+s.date+'</small>') : '');
          const marker = new mapboxgl.Marker().setLngLat(c).addTo(map);
          const popup = new mapboxgl.Popup({ offset: 24 }).setDOMContent(el);
          marker.setPopup(popup);
          el.addEventListener('click', () => { if (s.album_url) window.open(s.album_url, '_blank'); });
        });

        if (coords.length > 1) {
          const srcId = 'route-' + v.id;
          const layerId = 'route-line-' + v.id;
          map.addSource(srcId, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } }});
          map.addLayer({ id: layerId, type: 'line', source: srcId, paint: { 'line-width': 3 } });
        }

        const firstAlbum = v.stops.find(s => s.album_url)?.album_url;
        legend.innerHTML += '<div><strong>' + v.title + '</strong>' + (firstAlbum ? (' — <a target="_blank" href="'+firstAlbum+'">album</a>') : '') + '</div>';
      });

      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 60 });
    });
  </script>
</body></html>`);
});

web.get('/api/v1/vacations', (_, res) => {
  res.json({ vacations: getAllVacationsWithStops() });
});

const port = process.env.PORT || 3000;
web.listen(port, () => console.log('Web on http://localhost:' + port));

(async () => {
  await bolt.start();
  console.log('⚡️ Lolidays running (Socket Mode)');
})();
