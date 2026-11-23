"use strict";

const bucketPath = "/storage/v1/object";
const bucket = "camino-evidencias";
const types = new Set(["image/jpeg","image/png","image/webp","video/mp4","video/quicktime","video/webm"]);
const colors = {pendiente:"#606b66","en-obra":"#f5b722",pavimentado:"#158048"};
let roadRows = [];
let route = [];
let cumulative = [];
let map;
let roadLayer;
let galleryRequest = 0;
let reviewRequest = 0;

function readRoute(text, filename) {
  let points;
  if (/\.gpx$|\.kml$/i.test(filename)) {
    const xml = new DOMParser().parseFromString(text, "application/xml");
    const tracks = xml.getElementsByTagNameNS("*", /\.gpx$/i.test(filename) ? "trkseg" : "LineString");
    if (xml.querySelector("parsererror") || tracks.length !== 1) {
      throw new Error("El archivo debe contener un solo recorrido continuo.");
    }
    points = /\.gpx$/i.test(filename)
      ? [...tracks[0].getElementsByTagNameNS("*", "trkpt")].map(p => [p.getAttribute("lat"),p.getAttribute("lon")].map(v => v === null || !v.trim() ? NaN : Number(v)))
      : tracks[0].getElementsByTagNameNS("*", "coordinates")[0]?.textContent.trim().split(/\s+/).map(p => p.split(",").slice(0,2).map(Number).reverse());
  } else {
    let json = JSON.parse(text);
    if (json.type === "FeatureCollection" && json.features?.length === 1) json = json.features[0];
    if (json.type === "Feature") json = json.geometry;
    points = json?.type === "LineString" && json.coordinates.map(p => [p[1],p[0]]);
  }
  if (!Array.isArray(points) || points.length < 2 || points.length > 15000 ||
      points.some(([lat,lon]) => !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>85 || Math.abs(lon)>180)) {
    throw new Error("Selecciona un recorrido válido de 2 a 15.000 puntos.");
  }
  if (!points.some(([lat,lon]) => lat!==points[0][0] || lon!==points[0][1])) {
    throw new Error("El recorrido debe tener una longitud mayor que cero.");
  }
  return points;
}

function atMeter(meter) {
  const i = cumulative.findIndex(distance => distance >= meter);
  if (i <= 0) return i === 0 ? route[0] : route.at(-1);
  const fraction = (meter - cumulative[i-1]) / (cumulative[i] - cumulative[i-1]);
  return route[i-1].map((coordinate,axis) => coordinate + fraction*(route[i][axis]-coordinate));
}

function showGalleryFor(id) {
  $("gallery-segment").value = String(id);
  renderGallery();
  location.hash = "#galeria";
}

function updateMap(fit = false) {
  if (!roadEnabled) return;
  if (!route.length) {
    $("map-status").textContent = "El mapa aparecerá cuando el equipo importe el trazado real del camino.";
    return;
  }
  if (!window.L) {
    $("map-status").textContent = "No se pudo cargar el mapa.";
    return;
  }
  if (!map) {
    $("road-map").hidden = $("map-legend").hidden = false;
    map = L.map("road-map",{maxZoom:22});
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
      maxNativeZoom:19,maxZoom:22,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);
    roadLayer = L.layerGroup().addTo(map);
    fit = true;
  }
  cumulative = [0];
  for (let i=1; i<route.length; i++) {
    cumulative.push(cumulative[i-1] + L.latLng(route[i-1]).distanceTo(route[i]));
  }
  roadLayer.clearLayers();
  const baseline = L.polyline(route,{color:colors.pendiente,weight:7}).addTo(roadLayer);
  const total = cumulative.at(-1);
  const intervals = [];
  let unlocated = 0;
  const ordered = [...roadRows].sort((a,b) => Number(a.estado === "pavimentado") - Number(b.estado === "pavimentado"));
  for (const row of ordered) {
    const start = Number(row.desde_metro);
    const end = Math.min(total,start+row.metros);
    if (row.desde_metro == null || !Number.isFinite(start) || start < 0 || start >= end) {
      unlocated++;
      continue;
    }
    if (row.estado === "pavimentado") intervals.push([start,end]);
    const points = [atMeter(start),...route.filter((_,i)=>cumulative[i]>start&&cumulative[i]<end),atMeter(end)];
    const popup = card(row.nombre,number.format(row.metros)+" m · "+states[row.estado]);
    const button = element("button","Ver evidencias");
    button.type = "button";
    button.addEventListener("click",()=>showGalleryFor(row.id));
    popup.append(button);
    L.polyline(points,{color:colors[row.estado],weight:8}).addTo(roadLayer).bindPopup(popup);
  }
  let previousEnd = 0, paved = 0;
  for (const [start,end] of intervals.sort((a,b)=>a[0]-b[0])) {
    paved += Math.max(0,end-Math.max(start,previousEnd));
    previousEnd = Math.max(previousEnd,end);
  }
  $("map-status").textContent = number.format(Math.round(paved))+" m pavimentados de "+number.format(Math.round(total))+
    " m de trazado medido."+ (unlocated ? " Tramos por ubicar: "+unlocated+"." : "");
  if (fit) map.fitBounds(baseline.getBounds(),{padding:[20,20],maxZoom:20});
}

function populateTramos() {
  for (const select of [$("gallery-segment"),$("evidence-form").elements.tramo_id]) {
    const selected = select.value;
    select.replaceChildren(select.options[0],...roadRows.map(row => {
      const option = element("option",row.nombre);
      option.value = row.id;
      return option;
    }));
    if ([...select.options].some(option=>option.value===selected)) select.value = selected;
  }
}

async function storage(path,{method="POST",body,type="application/json",token} = {}) {
  const headers = {apikey:config.publishableKey,"Content-Type":type};
  if (token) headers.Authorization = "Bearer "+token;
  const response = await fetch(config.supabaseUrl + bucketPath + path,{method,headers,body});
  if (!response.ok) throw new Error("No se pudo acceder al archivo.");
  return response.json();
}

async function evidenceCard(row,token) {
  const signed = await storage("/sign/"+bucket+"/"+encodeURIComponent(row.id),{
    body:JSON.stringify({expiresIn:900}),token
  });
  if (!signed.signedURL?.startsWith("/object/sign/")) throw new Error("No hay archivo disponible.");
  const url = config.supabaseUrl + "/storage/v1" + signed.signedURL;
  const tramo = roadRows.find(item=>item.id===row.tramo_id);
  const node = card(row.etapa+" · "+(tramo?.nombre ?? "Camino Maní del Cardal"),row.descripcion);
  const media = document.createElement(row.tipo.startsWith("image/") ? "img" : "video");
  if (media.tagName === "IMG") {
    media.alt = row.descripcion || "Foto de la obra";
    media.loading = "lazy";
  } else {
    media.controls = true;
    media.playsInline = true;
    media.preload = "none";
  }
  media.src = url;
  node.append(media);
  return node;
}

async function renderGallery() {
  if (!roadEnabled) return;
  const request = ++galleryRequest;
  const id = $("gallery-segment").value;
  try {
    const rows = await api("/rest/v1/evidencias?estado=eq.publicada&order=creada.desc&limit=48"+(id?"&tramo_id=eq."+encodeURIComponent(id):""));
    const nodes = await Promise.allSettled(rows.map(row=>evidenceCard(row)));
    if (request !== galleryRequest) return;
    $("gallery-items").replaceChildren(...nodes.filter(result=>result.status==="fulfilled").map(result=>result.value));
    $("gallery-status").textContent = !rows.length ? "Todavía no hay evidencias publicadas para esta selección."
      : nodes.some(result=>result.status==="rejected") ? "Hay archivos que no se pudieron mostrar." : "";
  } catch {
    if (request === galleryRequest) $("gallery-status").textContent = "La galería no se pudo cargar.";
  }
}

async function renderReview() {
  const token = session;
  const request = ++reviewRequest;
  if (!token || !$("review-admin").open) return;
  $("review-items").replaceChildren();
  $("review-status").textContent = "Cargando aportes…";
  try {
    const rows = await api("/rest/v1/evidencias?estado=eq.pendiente&order=creada.desc&limit=50",{token});
    const results = await Promise.allSettled(rows.map(async row=>{
      const node = await evidenceCard(row,token);
      for (const [label,estado] of [["Publicar","publicada"],["Rechazar","rechazada"]]) {
        const action = element("button",label);
        action.type = "button";
        action.addEventListener("click",async()=>{
          if (session !== token) return;
          const buttons = [...node.querySelectorAll("button")];
          buttons.forEach(button=>button.disabled=true);
          try {
            await api("/rest/v1/evidencias?id=eq."+row.id+"&estado=eq.pendiente",{method:"PATCH",body:{estado},token});
            await Promise.all([renderReview(),renderGallery()]);
          } catch {
            $("review-status").textContent = "No se pudo guardar la revisión.";
            buttons.forEach(button=>button.disabled=false);
          }
        });
        node.append(action);
      }
      return node;
    }));
    if (request !== reviewRequest || token !== session) return;
    const available = results.filter(result=>result.status==="fulfilled").map(result=>result.value);
    $("review-items").replaceChildren(...available);
    $("review-status").textContent = available.length ? "" : "No hay archivos pendientes de revisión.";
  } catch {
    if (request === reviewRequest) $("review-status").textContent = "No se pudieron cargar los aportes pendientes.";
  }
}

function videoDuration(file) {
  return new Promise((resolve,reject)=>{
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    const timeout = setTimeout(()=>finish(new Error("No se pudo verificar la duración del video.")),8000);
    function finish(error) {
      clearTimeout(timeout);
      video.onloadedmetadata = video.onerror = null;
      video.removeAttribute("src");
      URL.revokeObjectURL(url);
      if (error) reject(error); else resolve();
    }
    video.preload = "metadata";
    video.onloadedmetadata = ()=>finish(
      video.duration > 0 && video.duration <= 30 ? null : new Error("El video debe durar hasta 30 segundos.")
    );
    video.onerror = ()=>finish(new Error("Este navegador no pudo leer el video. Prueba con un MP4."));
    video.src = url;
  });
}

$("evidence-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const file = data.get("archivo");
  const feedback = $("gallery-status");
  if (!types.has(file?.type) || !file.size || file.size>10485760) {
    feedback.textContent = "Elige una foto JPG, PNG o WebP, o un video MP4, MOV o WebM de hasta 10 MB.";
    return;
  }
  const button = form.querySelector("button");
  button.disabled = true;
  feedback.textContent = "Enviando aporte…";
  try {
    if (file.type.startsWith("video/")) await videoDuration(file);
    const id = crypto.randomUUID();
    await api("/rest/v1/evidencias",{method:"POST",body:{
      id,tramo_id:data.get("tramo_id") ? Number(data.get("tramo_id")) : null,tipo:file.type,etapa:data.get("etapa"),descripcion:data.get("descripcion").trim()
    }});
    await storage("/"+bucket+"/"+id,{body:file,type:file.type});
    form.reset();
    feedback.textContent = "Aporte recibido. Se mostrará en la galería si el equipo lo aprueba.";
  } catch (error) {
    feedback.textContent = error.message+" Si el problema continúa, comunícate con el equipo de la obra.";
  } finally {
    button.disabled = false;
  }
});

$("route-form").addEventListener("submit",async event=>{
  event.preventDefault();
  const form = event.currentTarget;
  const token = session;
  if (!token) return;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const file = form.elements.ruta.files[0];
    if (file.size>2097152) throw new Error("El archivo debe pesar hasta 2 MB.");
    const points = readRoute(await file.text(),file.name);
    await api("/rest/v1/trazado"+(route.length?"?id=eq.1":""),{
      method:route.length?"PATCH":"POST",body:route.length?{puntos:points}:{id:1,puntos:points},token
    });
    route = points;
    updateMap(true);
    form.reset();
    $("route-status").textContent = "Trazado guardado. Ya puedes ubicar los tramos por metro de inicio.";
  } catch (error) {
    $("route-status").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("gallery-segment").addEventListener("change",renderGallery);
$("review-admin").addEventListener("toggle",renderReview);
$("refresh-review").addEventListener("click",renderReview);
window.addEventListener("camino:tramos",event=>{
  roadRows = event.detail;
  populateTramos();
  updateMap();
});
window.addEventListener("camino:sesion",()=>{
  $("map-admin").hidden = $("review-admin").hidden = !session || !roadEnabled;
  if (!session) {
    reviewRequest++;
    $("review-admin").open = false;
    $("review-items").replaceChildren();
    $("review-status").textContent = "";
  }
});
if (ready) {
  Promise.all([
    api("/rest/v1/trazado?id=eq.1"),
    api("/rest/v1/evidencias?select=id&limit=1")
  ]).then(([rows])=>{
    route = rows[0]?.puntos ?? [];
    roadEnabled = true;
    $("submission").hidden = $("gallery-filter").hidden = false;
    document.querySelectorAll("[data-evidence-link]").forEach(link=>link.hidden=false);
    if (session) {
      $("map-admin").hidden = $("review-admin").hidden = false;
      if (!editing && ![...$("fields").querySelectorAll("input,textarea")].some(field=>field.value)) setEditor();
    }
    updateMap(true);
    renderGallery();
  }).catch(()=>{
    $("map-status").textContent = "El mapa se habilitará al activar la configuración de la obra.";
    $("gallery-status").textContent = "La galería aún está pendiente de activación.";
  });
}
