// Leitura do lance a lance da ESPN para a aba Ao vivo de padroes.html (funções puras, testáveis no Node).
// Reconstrói o que cada jogador tinha até o fim de um período, para checar as situações da análise do dia.

const FALTA = /foul|charge|personal block|shooting block/i;

// A ESPN às vezes manda o status fora de ordem (11/11/2026, OKC @ POR: "fim do 3º" e placar errado na volta do
// intervalo). Confere com o último lance e corrige no próprio summary (todas as abas leem dele):
//   - status num período que ainda não tem lance e relógio em 0 → começo desse período;
//   - relógio em 0 sem "End Period" no último lance do mesmo período → relógio do último lance;
//   - status atrás do lance a lance → período, relógio e placar do último lance;
//   - placar do cabeçalho atrás do último lance → placar do lance.
const segs = (txt) => {
  const t = String(txt ?? "");
  return t.includes(":") ? t.split(":").reduce((m, x) => (Number(m) || 0) * 60 + (Number(x) || 0)) : Number(t) || 0;
};
const ORD = ["1st", "2nd", "3rd", "4th"];
export function consertarResumo(s) {
  const comp = s?.header?.competitions?.[0], st = comp?.status, plays = s?.plays;
  if (!st || st.type?.state !== "in" || !plays?.length) return s;
  const ult = plays[plays.length - 1];
  const lp = Number(ult.period?.number) || 0;
  const fimLance = /end period|end game/i.test(ult.type?.text || "") || /^end of/i.test(ult.text || "");
  const p = Number(st.period) || 0, resta = segs(st.displayClock);
  const nome = st.type?.name || "";
  let novo = null;
  if (p < lp) novo = { p: lp, resta: fimLance ? 0 : segs(ult.clock?.displayValue), fim: fimLance };
  else if (p > lp && resta === 0) novo = { p, resta: p > 4 ? 300 : 720, fim: false };
  else if (p === lp && resta === 0 && !fimLance && !/END_PERIOD|HALFTIME/.test(nome)) novo = { p, resta: segs(ult.clock?.displayValue), fim: false };
  if (novo) {
    const rel = `${Math.floor(novo.resta / 60)}:${String(Math.round(novo.resta % 60)).padStart(2, "0")}`;
    const q = novo.p > 4 ? `OT${novo.p > 5 ? novo.p - 4 : ""}` : ORD[novo.p - 1];
    st.period = novo.p;
    st.displayClock = rel;
    st.type = { ...st.type, name: novo.fim ? "STATUS_END_PERIOD" : "STATUS_IN_PROGRESS", shortDetail: novo.fim ? `End of ${q}` : `${rel} - ${q}`, detail: novo.fim ? `End of ${q}` : `${rel} - ${q}` };
    st.corrigido = true;
  }
  const casa = comp.competitors?.find((c) => c.homeAway === "home"), fora = comp.competitors?.find((c) => c.homeAway === "away");
  if (casa && fora && ult.homeScore != null && ult.awayScore != null
      && (Number(casa.score) || 0) + (Number(fora.score) || 0) < Number(ult.homeScore) + Number(ult.awayScore)) {
    casa.score = String(ult.homeScore);
    fora.score = String(ult.awayScore);
  }
  return s;
}

// Estatísticas por atleta somando as jogadas até o fim do período `ate` (1 = fim do Q1, 2 = intervalo, 3 = fim do 3º).
export function contarAte(plays, ate) {
  const out = {};
  const de = (id) => (out[id] ??= { pts: 0, fga: 0, reb: 0, ast: 0, tpm: 0, pf: 0, tpa: 0, fta: 0, tov: 0, stl: 0, blk: 0 });
  for (const p of plays || []) {
    if ((p.period?.number ?? 99) > ate) break;
    const tipo = p.type?.text || "";
    const ids = (p.participants || []).map((x) => x.athlete?.id).filter(Boolean);
    if (!ids.length) continue;
    // perdas, roubos e tocos (08/11; conferido contra o box: 72/72): perda = 1º participante; roubo e toco = 2º
    if (/turnover/i.test(tipo)) {
      de(ids[0]).tov += 1;
      if (ids[1] && /steals/i.test(p.text || "")) de(ids[1]).stl += 1;
      continue;
    }
    if (p.shootingPlay && !p.scoringPlay && ids[1] && / blocks /.test(p.text || "")) de(ids[1]).blk += 1;
    if (/free throw/i.test(tipo)) {
      de(ids[0]).fta += 1;
      if (p.scoringPlay) de(ids[0]).pts += 1;
    } else if (p.shootingPlay) {
      const a = de(ids[0]);
      a.fga += 1;
      if (p.pointsAttempted === 3) a.tpa += 1;
      if (p.scoringPlay) {
        a.pts += p.scoreValue || 0;
        if (p.scoreValue === 3) a.tpm += 1;
        if (ids[1] && /assist/i.test(p.text || "")) de(ids[1]).ast += 1;
      }
    } else if (/rebound/i.test(tipo)) {
      de(ids[0]).reb += 1;
    } else if (FALTA.test(tipo) && !/technical|turnover/i.test(tipo)) {
      de(ids[0]).pf += 1;
    }
  }
  return out;
}

// Segundos de jogo (tempo normal) de uma jogada ou do status: quarto + relógio "m:ss" restando.
// No último minuto a ESPN manda só os segundos ("34.5", sem ":"): não ler como 34 minutos.
export function tempoDe(periodo, relogio) {
  const txt = String(relogio || "0:00");
  const resta = txt.includes(":") ? txt.split(":").reduce((m, s) => (Number(m) || 0) * 60 + (Number(s) || 0)) : Number(txt) || 0;
  return (Math.min(periodo, 4) - 1) * 720 + 720 - resta;
}

// O jogador está em quadra? Pelas substituições ("X enters the game for Y": 1º participante entra, 2º sai) e por qualquer
// jogada dele depois da última saída. Entre quartos a ESPN não registra trocas: sem registro no quarto atual, diz que não sabe.
export function emQuadra(plays, id, titular) {
  // compara pela ordem das jogadas, não pelo relógio: troca e lance livre acontecem no mesmo segundo
  let entrou = -1, saiu = -1, acao = -1, tEnt = 0, tSai = 0, tAc = 0;
  (plays || []).forEach((p, i) => {
    const t = tempoDe(p.period?.number ?? 1, p.clock?.displayValue);
    const ids = (p.participants || []).map((x) => x.athlete?.id);
    if (/substitution/i.test(p.type?.text || "")) {
      if (ids[0] === id) { entrou = i; tEnt = t; }
      if (ids[1] === id) { saiu = i; tSai = t; }
    } else if (ids.includes(id)) { acao = i; tAc = t; }
  });
  if (saiu < 0) return { quadra: entrou >= 0 || acao >= 0 || !!titular, desde: tEnt };
  // jogada no mesmo segundo da saída não conta como volta (a ESPN lança a troca antes dos lances livres do mesmo lance)
  const voltou = entrou > saiu || (acao > saiu && tAc > tSai);
  return { quadra: voltou, desde: voltou ? (entrou > acao ? tEnt : tAc) : tSai };
}

// Placar do time (sigla) menos o do adversário, somando os períodos até `ate`.
export function margemAte(competitors, sigla, ate) {
  const soma = (c) => (c.linescores || []).slice(0, ate).reduce((t, l) => t + Number(l.displayValue ?? l.value ?? 0), 0);
  const eu = competitors.find((c) => c.team?.abbreviation === sigla);
  const ele = competitors.find((c) => c.team?.abbreviation !== sigla);
  return eu && ele ? soma(eu) - soma(ele) : null;
}

// O período `ate` já terminou? (encerrado, fim de período, intervalo ou já no seguinte)
export function fechou(status, ate) {
  const p = status?.period ?? 0, nome = status?.type?.name || "";
  return status?.type?.completed || p > ate || (p === ate && /END_PERIOD|HALFTIME/.test(nome));
}

// Condição da análise (expressão Python simples) → função JS sobre as variáveis do corte.
export function condicao(py) {
  const js = py
    .replace(/(-?[\d.]+)\s*<=\s*(\w+)\s*<=\s*(-?[\d.]+)/g, "($1 <= $2 && $2 <= $3)")
    .replace(/"([^"]+)" in fora/g, (_, n) => `fora.includes(${JSON.stringify(n)})`)
    .replace(/\band\b/g, "&&").replace(/\bor\b/g, "||").replace(/\bnot\b/g, "!");
  // eslint-disable-next-line no-new-func
  const f = new Function("v", `const {z_pts, z_fga, z_reb, z_ast, z_tpm, z_tov, z_stl, z_blk, pf, margem, fora} = v; return (${js});`);
  return (v) => { try { return !!f(v); } catch { return false; } };
}

// Variáveis do corte para um jogador: z de cada estatística pela régua dele (minutos típicos), faltas e placar.
export function variaveis(st, regua, margem, fora) {
  const v = { pf: st?.pf ?? 0, margem, fora: fora || [] };
  for (const k of ["pts", "fga", "reb", "ast", "tpm", "tov", "stl", "blk"]) {
    const r = regua?.[k];
    v[`z_${k}`] = r && r.dp > 0 ? ((st?.[k] ?? 0) - r.esperado) / r.dp : 0;
  }
  return v;
}

// Segundos em quadra em cada período (índice 0 = Q1; prorrogações depois do Q4), pelas substituições do lance a lance.
// Entre períodos a ESPN não registra trocas: ele começa o período em quadra se a 1ª jogada dele no período não for a
// entrada (aparece numa jogada ou sai antes de entrar). Sem nenhuma jogada no período = não jogou o período.
// `agora` = {p, resta}: o período em andamento conta só até o relógio atual.
export function segundosPorPeriodo(plays, id, agora) {
  const dur = (p) => (p > 4 ? 300 : 720);
  const porP = new Map();
  for (const x of plays || []) {
    const p = x.period?.number ?? 1;
    if (!porP.has(p)) porP.set(p, []);
    porP.get(p).push(x);
  }
  const out = [];
  const ultimo = agora?.p || Math.max(0, ...porP.keys());
  for (let p = 1; p <= ultimo; p++) {
    const L = porP.get(p) || [];
    const fim = p === agora?.p ? dur(p) - agora.resta : dur(p);
    let quadra = null, desde = 0, soma = 0;
    for (const x of L) {
      const ids = (x.participants || []).map((y) => y.athlete?.id);
      if (!ids.includes(id)) continue;
      const t = dur(p) - relogioS(x.clock?.displayValue);
      const sub = /substitution/i.test(x.type?.text || "");
      if (quadra === null) { quadra = !(sub && ids[0] === id); desde = 0; }
      if (sub && ids[0] === id && !quadra) { quadra = true; desde = t; }
      else if (sub && ids[1] === id && quadra) { soma += t - desde; quadra = false; }
    }
    if (quadra) soma += Math.max(0, fim - desde);
    out.push(Math.max(0, soma));
  }
  return out;
}
const relogioS = (txt) => {
  const s = String(txt || "0:00");
  return s.includes(":") ? s.split(":").reduce((m, x) => (Number(m) || 0) * 60 + (Number(x) || 0)) : Number(s) || 0;
};
