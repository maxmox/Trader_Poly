// Leitura do lance a lance da ESPN para a aba Ao vivo de padroes.html (funções puras, testáveis no Node).
// Reconstrói o que cada jogador tinha até o fim de um período, para checar as situações da análise do dia.

const FALTA = /foul|charge|personal block|shooting block/i;

// Estatísticas por atleta somando as jogadas até o fim do período `ate` (1 = fim do Q1, 2 = intervalo, 3 = fim do 3º).
export function contarAte(plays, ate) {
  const out = {};
  const de = (id) => (out[id] ??= { pts: 0, fga: 0, reb: 0, ast: 0, tpm: 0, pf: 0, tpa: 0, fta: 0 });
  for (const p of plays || []) {
    if ((p.period?.number ?? 99) > ate) break;
    const tipo = p.type?.text || "";
    const ids = (p.participants || []).map((x) => x.athlete?.id).filter(Boolean);
    if (!ids.length) continue;
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
  const f = new Function("v", `const {z_pts, z_fga, z_reb, z_ast, z_tpm, pf, margem, fora} = v; return (${js});`);
  return (v) => { try { return !!f(v); } catch { return false; } };
}

// Variáveis do corte para um jogador: z de cada estatística pela régua dele (minutos típicos), faltas e placar.
export function variaveis(st, regua, margem, fora) {
  const v = { pf: st?.pf ?? 0, margem, fora: fora || [] };
  for (const k of ["pts", "fga", "reb", "ast", "tpm"]) {
    const r = regua?.[k];
    v[`z_${k}`] = r && r.dp > 0 ? ((st?.[k] ?? 0) - r.esperado) / r.dp : 0;
  }
  return v;
}
