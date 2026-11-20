/**
 * What a question wants beyond the snapshot, read from its English or Bahasa Indonesia words: values, a past time, host details or a person. The words are a screen and not a judge: a question
 * that is missed is answered from the snapshot alone, as it was before, and one that is caught by mistake costs a read that the model does not use. What is read is not decided here;
 * `assistantFocus.ts` decides that, from what the question names and what the user may see.
 */

import { portOf } from './assistantPorts.js';
import { windowOf } from './assistantWhen.js';

export type Metric = 'cpu' | 'memory' | 'temperature' | 'disk' | 'traffic' | 'uptime' | 'latency';

/** The order the values are given in, whichever way a question puts them. */
const METRIC_ORDER: readonly Metric[] = ['cpu', 'memory', 'temperature', 'disk', 'traffic', 'uptime', 'latency'];

const METRIC_WORDS: Record<Metric, RegExp> = {
  cpu: /\b(cpu(nya)?|prosesor(nya)?|processor)\b/i,
  memory: /\b(memory|memori(nya)?|ram(nya)?)\b/i,
  temperature: /\b(temperature|temp|temperatur|suhu(nya)?|panas(nya)?|overheat(ing)?)\b/i,
  disk: /\b(disk|harddisk|hard disk|ssd|storage|penyimpanan|free space)\b/i,
  traffic: /\b(traffic|trafik(nya)?|bandwidth|throughput|kecepatan(nya)?|speed|bps|kbps|mbps|gbps)\b/i,
  uptime: /\b(uptime|up time|reboot(ed)?|restart(ed)?|booted|lama (menyala|hidup))\b/i,
  latency: /\b(latency|latensi(nya)?|rtt|response time|waktu respon|packet loss|jitter|loss)\b/i,
};

/** Words for a time that has gone, beyond those of a time that `windowOf` reads. */
const PAST_WORDS = /\b(kemarin|semalam|tadi|yesterday|last night|history|histori|riwayat|sejarah|berapa kali|how many times|how often|seberapa sering|pernah|sempat|earlier|resolved|closed|recovered|pulih|sudah (selesai|normal|beres)|incident|insiden|kejadian)\b/i;

/** Words for the SLA and the availability figures, which another part answers: a month of them is not a list of problems. */
const SLA_WORDS = /\b(sla|slo|availability|ketersediaan)\b/i;

/** Words for a count or a pattern over time, which want more than a day. */
const COUNT_WORDS = /\b(berapa kali|how many times|how often|seberapa sering|frekuensi|frequency|flap|flapping|bolak-balik)\b/i;

/** Words for the details a host holds: where it is, what it is, how to reach it, how it is grouped. */
const DETAIL_WORDS = /\b(ip|ip address|alamat|address|lokasi|location|di ?mana|where|owner|pemilik|penanggung jawab|pic|kontak|contact|siapa|who|vendor|merek|merk|model|serial|serial number|tag|tags|label|group|grup|template|maintenance|pemeliharaan|perawatan|inventory|inventaris|deskripsi|description|tipe|type)\b/i;

/** Words for who dealt with a problem and what they wrote about it. */
const ACK_WORDS = /\b(acknowledge[ds]?|acknowledg?ements?|acknowledgments?|ack(ed|s)?|di-?ack|diacknowledge|ditangani|menangani|handled|tindak ?lanjut|follow-?up|komentar|comments?|catatan)\b/i;

/** Words that ask for a list, and the things they list when they are problems. */
const LIST_WORDS = /\b(semua|seluruh|all|every|daftar|list|sebutkan|tampilkan|show)\b/i;
const PROBLEM_NOUNS = /\b(problems?|masalah|alerts?|alarms?|issues?|gangguan)\b/i;

/** Words for the WAN links, and for the web checks. */
const LINK_WORDS = /\b(wan|sd-?wan|links?|jalur|lintasan|tunnel|vpn|failover|redundan\w*)\b/i;
const WEB_WORDS = /\b(web ?checks?|web monitoring|web scenarios?|scenarios?|website|situs web|http ?checks?)\b/i;

/** Words for the course of a value over a time: an average, a trend, a graph; and for its peak, which asks for a series only beside a time. */
const SERIES_WORDS = /\b(rata-?rata|average|avg|mean|trend|tren|grafik|graph|fluktuasi|sepanjang)\b/i;
const PEAK_WORDS = /\b(tertinggi|terendah|maksimum|maximum|minimum|puncak|peak|max|min)\b/i;

/** Words for the report pages: capacity trends, alert noise, the top triggers, the inventory scorecard. */
/** Words that mean the Capacity report whatever else is said, and the weak one, which also means a link's bandwidth and so needs a metric or a host beside it (BK-87). */
const CAPACITY_STRONG = /\b(saturasi|forecast|prediksi|pertumbuhan(nya)?|growth|hampir penuh|nearly full|paling penuh|most full|fullest)\b/i;
const CAPACITY_WEAK = /\b(capacity|kapasitas(nya)?)\b/i;
/** A question about a link, the internet or a bandwidth is about the link's rate, never the Capacity report. */
const LINKISH = /\b(wan|sd-?wan|links?|jalur|lintasan|tunnel|vpn|isp|internet|bandwidth|bandwith|kecepatan|throughput|bps|kbps|mbps|gbps)\b/i;
const NOISE_WORDS = /\b(noise|noisy|noisiest|loudest|bising|berisik|alert fatigue|flapping|kronis|chronic|paling sering (alert|bunyi)|sering alert)\b/i;
const TRIGGER_WORDS = /\b(top (\d+ )?triggers?|trigger (paling|terbanyak|teratas)|paling sering muncul|sering muncul)\b/i;
const INVENTORY_WORDS = /\b(inventory|inventaris|scorecard|kelengkapan|ownership|kepemilikan|owner tag|tanpa owner|criticality)\b/i;

/** Words for the maps and for what a device is connected to. */
const MAP_WORDS = /\b(maps?|peta|topolog\w*|terhubung|tersambung|connected|connects?|connections?|neighbou?rs?|tetangga)\b/i;

/** Words for a planned stop of a host. */
const MAINTENANCE_WORDS = /\b(maintenance|pemeliharaan|perawatan|planned (outage|downtime)|scheduled (outage|downtime)|downtime terjadwal)\b/i;

/** Words for a person: asking for them asks for the contacts on record as well. */
const PEOPLE_WORDS = /\b(siapa|who|owner|pemilik|penanggung jawab|pic|kontak|contact|hubungi|telepon|phone|email|e-mail)\b/i;

/** Words for the internet links, for which a cold read of the gauges is waited for. */
const INTERNET_WORDS = /\b(internet|wan|isp|bandwidth|bandwith|kecepatan|speed|throughput|traffic|trafik|link|links|jalur|lintasan)\b/i;

export const internetAsked = (question: string): boolean => INTERNET_WORDS.test(question);

export interface Topics {
  /** The values asked for, in a fixed order. */
  metrics: Metric[];
  /** The question is about a time that has gone. */
  past: boolean;
  /** It counts or looks for a pattern, so a week is a better default than a day. */
  counts: boolean;
  /** It asks for what a host is: address, place, model, group, tags, maintenance. */
  details: boolean;
  /** It asks for a person, so the contacts on record are given too. */
  people: boolean;
  /** It asks who acknowledged a problem, or what was written about it. */
  acks: boolean;
  /** It is about the SLA or the availability, for which a window of its own may be named. */
  sla: boolean;
  /** It asks for the open problems as a list, beyond the few the snapshot names. */
  openAll: boolean;
  /** It asks about maintenance windows. */
  maintenance: boolean;
  /** It asks about the WAN links: their state, latency or loss. */
  links: boolean;
  /** It asks about the web checks. */
  web: boolean;
  /** It asks for the course of a value over a time: its lowest, average, highest. */
  series: boolean;
  /** It names a port of a device. */
  port: boolean;
  /** It asks about the capacity trends, the alert noise, the top triggers or the inventory scorecard. */
  capacity: boolean;
  /** The only word it has for the capacity trends is the weak one: the report is read when the question also names a host. */
  capacityOfHost: boolean;
  noise: boolean;
  triggers: boolean;
  inventory: boolean;
  /** It asks about the maps, or about what a device is connected to. */
  maps: boolean;
}

/** A moment late in a day, so that a part of a day that `windowOf` reads has already begun. */
const REFERENCE_NOW = Date.parse('2026-06-15T23:30:00Z') / 1000;

export function topicsOf(question: string): Topics {
  const counts = COUNT_WORDS.test(question);
  const acks = ACK_WORDS.test(question);
  // "Siapa yang acknowledge ..." asks who dealt with a problem, not for the contacts of a host.
  const subject = acks ? question.replace(/\b(siapa|who)\b/gi, ' ') : question;
  const maintenance = MAINTENANCE_WORDS.test(question);
  const links = LINK_WORDS.test(question);
  const windowed = windowOf(question, REFERENCE_NOW, 'UTC') !== null;
  const metrics = METRIC_ORDER.filter((m) => METRIC_WORDS[m].test(question) && !(links && m === 'latency'));
  const series = metrics.length > 0 && (SERIES_WORDS.test(question) || (PEAK_WORDS.test(question) && windowed));
  const linkish = LINKISH.test(question);
  const capacity = !linkish && (CAPACITY_STRONG.test(question) || (CAPACITY_WEAK.test(question) && metrics.length > 0));
  const capacityOfHost = !linkish && CAPACITY_WEAK.test(question) && !capacity;
  const noise = NOISE_WORDS.test(question);
  const triggers = TRIGGER_WORDS.test(question);
  const inventory = INVENTORY_WORDS.test(question);
  // A question about acknowledgements reads those, and not the whole list of what opened in the window beside them; a time beside "maintenance" is the time of the window, not of a problem.
  const past = !acks && !maintenance && !series && !capacity && !noise && !triggers && !SLA_WORDS.test(question) && (counts || PAST_WORDS.test(question) || windowed);
  return {
    // "Latency of the WAN link" asks for the links, not for the ping of a host.
    metrics,
    past,
    counts,
    details: DETAIL_WORDS.test(subject),
    people: PEOPLE_WORDS.test(subject),
    acks,
    sla: SLA_WORDS.test(question),
    openAll: LIST_WORDS.test(question) && PROBLEM_NOUNS.test(question) && !acks && !past,
    maintenance,
    links,
    web: WEB_WORDS.test(question),
    series,
    port: portOf(question) !== null,
    capacity,
    capacityOfHost,
    noise,
    triggers,
    inventory,
    maps: MAP_WORDS.test(question),
  };
}

/** Whether a question asks about one thing, a host or a site, so that a follow-up with no name is about the one before it, and not about the whole estate (BK-90). The reports are the estate's. */
export const aboutAThing = (t: Topics): boolean => t.metrics.length > 0 || t.past || t.details || t.people || t.acks || t.openAll || t.maintenance || t.links || t.port || t.maps || t.series;
