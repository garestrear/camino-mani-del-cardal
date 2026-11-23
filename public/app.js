"use strict";
const $ = id => document.getElementById(id);
const config = window.CAMINO;
const ready = /^https:\/\/[a-z0-9]+\.supabase\.co$/.test(config.supabaseUrl) &&
  /^sb_publishable_[a-zA-Z0-9_-]+$/.test(config.publishableKey);
const number = new Intl.NumberFormat("es-CO");
const currency = new Intl.NumberFormat("es-CO", {style:"currency",currency:"COP",maximumFractionDigits:0});
const today = () => new Intl.DateTimeFormat("sv-SE",{timeZone:"America/Bogota"}).format(new Date());
const states = {pendiente:"Pendiente","en-obra":"En obra",pavimentado:"Pavimentado"};
const kinds = {cemento:"Cemento",dinero:"Dinero",trabajo:"Trabajo"};
const table = $("editor").elements.table;
let session = null;
let editing = null;
let recordRequest = 0;
const fields = {
  tramos: [["nombre","Nombre del tramo","text"],["metros","Longitud en metros","number"],["estado","Estado",states],["detalle","Referencia o descripción","textarea"]],
  aportes: [["tipo","Tipo de aporte",kinds],["cantidad","Cantidad (bultos, pesos o horas según el tipo)","number"],["fecha","Fecha en que se recibió","date"],["detalle","Nota interna","textarea"]],
  necesidades: [["titulo","Título","text"],["detalle","Qué se necesita y cómo ayudar","textarea"],["activa","Mostrar al público","checkbox"]],
  historias: [["titulo","Título","text"],["detalle","Anécdota","textarea"],["publicada","Publicar en la página","checkbox"]]
};

function element(tag, value, className) {
  const node = document.createElement(tag);
  if (value !== undefined) node.textContent = value;
  if (className) node.className = className;
  return node;
}

function card(title, detail) {
  const node = element("article",undefined,"card");
  node.append(element("h3",title));
  if (detail) node.append(element("p",detail));
  return node;
}

function renderList(id, rows, render, empty) {
  $(id).replaceChildren(...(rows.length ? rows.map(render) : [element("p",empty,"muted")]));
}

async function api(path, {method="GET", body, token} = {}) {
  const headers = {apikey:config.publishableKey};
  if (token) headers.Authorization = "Bearer " + token;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const response = await fetch(config.supabaseUrl + path, {method,headers,body:JSON.stringify(body)});
  if (!response.ok) throw new Error("No se pudo completar la operación.");
  return response.status === 204 || response.status === 201 ? null : response.json();
}

async function loadPublic() {
  if (!ready) {
    $("status").textContent = "Vista previa. La conexión con la base de datos está pendiente.";
  }
  let tramos = [], totals = [], needs = [], stories = [];
  if (ready) {
    try {
      [tramos,totals,needs,stories] = await Promise.all([
        api("/rest/v1/tramos?order=id"),api("/rest/v1/rpc/totales_aportes"),
        api("/rest/v1/necesidades?order=id.desc"),api("/rest/v1/historias?order=id.desc")
      ]);
      $("status").textContent = "";
    } catch {
      $("status").textContent = "No se pudieron consultar los datos de la obra. Recarga la página para volver a intentar.";
      return;
    }
  }
  if (tramos.length) {
    const done = tramos.reduce((sum,row) => sum + (row.estado === "pavimentado" ? row.metros : 0),0);
    const measured = tramos.reduce((sum,row) => sum + row.metros,0);
    $("summary").textContent = number.format(done) + " m pavimentados de " + number.format(measured) + " m registrados por tramos.";
  }
  renderList("tramos",tramos,row => {
    const node = card(row.nombre,row.detalle);
    node.append(element("p",number.format(row.metros) + " m"),element("span",states[row.estado],"state " + row.estado));
    return node;
  },"Todavía no hay tramos publicados.");
  renderList("totals",Object.keys(kinds),type => {
    const total = totals.find(item => item.tipo === type)?.total ?? 0;
    const unit = type === "cemento" ? " bultos" : " horas";
    const value = !ready ? "Por registrar" : type === "dinero" ? currency.format(total) : number.format(total) + unit;
    const node = card(kinds[type]);
    node.append(element("strong",value));
    return node;
  });
  renderList("needs",needs,row => card(row.titulo,row.detalle),"Todavía no hay necesidades publicadas.");
  renderList("stories",stories,row => card(row.titulo,row.detalle),"Todavía no hay anécdotas publicadas.");
}

function setEditor(row = null) {
  editing = row?.id ?? null;
  $("reset").hidden = editing === null;
  $("fields").replaceChildren(...fields[table.value].map(([name,title,type]) => {
    const label = element("label",title);
    const input = element(typeof type === "object" ? "select" : type === "textarea" ? "textarea" : "input");
    input.name = name;
    if (typeof type === "object") {
      for (const [key,value] of Object.entries(type)) {
        const option = element("option",value);
        option.value = key;
        input.append(option);
      }
    } else if (type !== "textarea") input.type = type;
    if (type === "checkbox") input.checked = row?.[name] ?? name === "activa";
    else if (row) input.value = row[name];
    else if (type === "date") input.value = today();
    input.required = type !== "checkbox" && (name !== "detalle" || table.value === "historias");
    if (type === "number") {
      input.min = 1;
      input.max = name === "metros" ? 100000 : 2147483647;
    }
    if (type === "text" || type === "textarea") input.maxLength = type === "text" ? 120 : 2000;
    label.append(input);
    return label;
  }));
}

async function loadRecords() {
  const request = ++recordRequest;
  const name = table.value;
  const rows = await api("/rest/v1/" + name + "?order=id.desc",{token:session});
  if (request !== recordRequest || !session) return;
  renderList("records",rows,row => {
    const title = row.nombre ?? row.titulo ?? kinds[row.tipo] + " · " + row.fecha;
    const node = card(title,row.detalle);
    if (name === "aportes") node.append(element("p",number.format(row.cantidad)));
    const edit = element("button","Editar");
    edit.type = "button";
    edit.addEventListener("click",() => {
      setEditor(row);
      $("fields").querySelector("input,select,textarea").focus();
    });
    node.append(edit);
    return node;
  },"Todavía no hay registros de este tipo.");
}

$("login").addEventListener("submit",async event => {
  event.preventDefault();
  if (!ready) return;
  const form = event.currentTarget;
  const button = form.querySelector("button");
  button.disabled = true;
  try {
    const login = await api("/auth/v1/token?grant_type=password",{method:"POST",body:Object.fromEntries(new FormData(form))});
    const roles = await api("/rest/v1/coordinadores?select=usuario",{token:login.access_token});
    if (!roles.length) {
      $("notice").textContent = "Esta cuenta necesita acceso de coordinación.";
      return;
    }
    session = login.access_token;
    form.reset();
    form.hidden = true;
    $("panel").hidden = false;
    $("notice").textContent = "";
    setEditor();
    await loadRecords();
  } catch {
    $("notice").textContent = "No se pudo completar el ingreso o cargar los registros. Revisa tus datos e intenta de nuevo.";
  } finally {
    button.disabled = false;
  }
});

$("logout").addEventListener("click",() => {
  session = null;
  $("login").hidden = false;
  $("panel").hidden = true;
  $("notice").textContent = "";
  $("records").replaceChildren();
  setEditor();
});

table.addEventListener("change",() => {
  setEditor();
  $("records").replaceChildren();
  loadRecords().catch(() => { $("notice").textContent = "No se pudieron cargar los registros."; });
});
$("reset").addEventListener("click",() => setEditor());
$("editor").addEventListener("submit",async event => {
  event.preventDefault();
  if (!session) return;
  const name = table.value;
  const id = editing;
  const body = {};
  for (const [key,,type] of fields[name]) {
    const input = event.currentTarget.elements[key];
    body[key] = type === "checkbox" ? input.checked : type === "number" ? input.valueAsNumber : input.value.trim();
  }
  const save = event.currentTarget.querySelector("button");
  save.disabled = table.disabled = $("logout").disabled = $("reset").disabled = true;
  try {
    await api("/rest/v1/" + name + (id === null ? "" : "?id=eq." + id),{method:id === null ? "POST" : "PATCH",body,token:session});
    $("notice").textContent = "Registro guardado.";
    setEditor();
    await Promise.all([loadRecords(),loadPublic()]);
  } catch {
    $("notice").textContent = "No se pudo completar la operación. Verifica si el registro aparece antes de volver a guardarlo.";
  } finally {
    save.disabled = table.disabled = $("logout").disabled = $("reset").disabled = false;
  }
});
if (!ready) {
  $("login").hidden = true;
  $("notice").textContent = "El ingreso estará disponible al conectar Supabase.";
}
if (/^https:\/\//.test(config.contactUrl)) {
  $("contact").href = config.contactUrl;
  $("contact").hidden = false;
}
loadPublic();
