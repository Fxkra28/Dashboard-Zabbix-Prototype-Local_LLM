import { describe, expect, it } from 'vitest';
import { internetAsked, topicsOf } from '../services/assistantTopics.js';

/**
 * What a question wants beyond the snapshot, from its words in English and Bahasa Indonesia: which values of a host (CPU, memory, temperature, disk, traffic, uptime, latency), whether it is about
 * a time that has gone, and whether it asks for the details of a host or for the people behind it. A question about nothing of these gets nothing, and the snapshot alone answers it.
 */

describe('topicsOf: values of a host', () => {
  it('finds the metric a question names, in either language', () => {
    expect(topicsOf('berapa CPU switch 4.3.3 FPSO ARUBA 3?').metrics).toEqual(['cpu']);
    expect(topicsOf('what is the memory of the core switch?').metrics).toEqual(['memory']);
    expect(topicsOf('suhu dan memori host ini berapa?').metrics).toEqual(['memory', 'temperature']);
    expect(topicsOf('disk hampir penuh gak?').metrics).toEqual(['disk']);
    expect(topicsOf('how long has it been up? uptime?').metrics).toEqual(['uptime']);
    expect(topicsOf('latency ke Surabaya berapa ms, ada packet loss?').metrics).toEqual(['latency']);
    expect(topicsOf('berapa kecepatan trafik di port uplink?').metrics).toEqual(['traffic']);
  });

  it('knows the Indonesian ending -nya, which people put on the thing they ask about', () => {
    expect(topicsOf('host mana memorinya paling penuh?').metrics).toEqual(['memory']);
    expect(topicsOf('suhunya berapa dan CPUnya?').metrics).toEqual(['cpu', 'temperature']);
    expect(topicsOf('latensinya tinggi nggak?').metrics).toEqual(['latency']);
  });

  it('keeps the metrics in one fixed order, whichever way the question puts them', () => {
    expect(topicsOf('temperature, cpu and memory please').metrics).toEqual(['cpu', 'memory', 'temperature']);
  });

  it('does not take a word inside another word for a metric', () => {
    expect(topicsOf('the temporary workaround for the ramp at the camp').metrics).toEqual([]);
    expect(topicsOf('Ada yang down di Surabaya?').metrics).toEqual([]);
  });
});

describe('topicsOf: a time that has gone', () => {
  it('knows a question about the past from its words, or from a time it names', () => {
    expect(topicsOf('tadi malam ada masalah apa?').past).toBe(true);
    expect(topicsOf('what happened yesterday').past).toBe(true);
    expect(topicsOf('berapa kali DELTA-SW01 down minggu ini?').past).toBe(true);
    expect(topicsOf('how many times did it go down?').past).toBe(true);
    expect(topicsOf('apa sudah resolved?').past).toBe(true);
    expect(topicsOf('riwayat masalah di Surabaya').past).toBe(true);
    expect(topicsOf('problems in the last 3 hours').past).toBe(true);
  });

  it('knows a question that counts or lists, which wants more than a day', () => {
    expect(topicsOf('berapa kali X down?').counts).toBe(true);
    expect(topicsOf('how often does it flap').counts).toBe(true);
    expect(topicsOf('tadi malam ada apa?').counts).toBe(false);
  });

  it('is not about problems when it asks for the SLA of a time, which another part answers', () => {
    expect(topicsOf('Which sites missed SLA last month?').past).toBe(false);
    expect(topicsOf('berapa availability bulan lalu?').past).toBe(false);
    expect(topicsOf('SLA kemarin berapa persen').past).toBe(false);
  });

  it('is not about the past when it asks about now', () => {
    expect(topicsOf('Ada yang down di Surabaya sekarang?').past).toBe(false);
    expect(topicsOf('which site is worst').past).toBe(false);
  });
});

describe('topicsOf: the details of a host and the people behind it', () => {
  it('finds a question for an address, a place, a model or a group', () => {
    expect(topicsOf('apa IP address 5.1 FGT60F-01-INDIA?').details).toBe(true);
    expect(topicsOf('di mana lokasi switch ini').details).toBe(true);
    expect(topicsOf('what model and vendor is it?').details).toBe(true);
    expect(topicsOf('which group and tags does the host have').details).toBe(true);
    expect(topicsOf('is it in maintenance?').details).toBe(true);
  });

  it('finds a question for a person, which asks for the contacts as well', () => {
    const t = topicsOf('siapa penanggung jawab di situs Surabaya?');
    expect(t.details).toBe(true);
    expect(t.people).toBe(true);
    expect(topicsOf('who is the owner of this switch').people).toBe(true);
    expect(topicsOf('apa IP address host ini').people).toBe(false);
  });

  it('asks for nothing when the question is about the state of the estate', () => {
    expect(topicsOf('what needs attention right now?')).toEqual({ metrics: [], past: false, counts: false, details: false, people: false, acks: false, sla: false, openAll: false, maintenance: false, links: false, web: false, series: false, port: false, capacity: false, capacityOfHost: false, noise: false, triggers: false, inventory: false, maps: false });
  });
});

describe('internetAsked', () => {
  it('knows a question about the internet links, in either language', () => {
    expect(internetAsked('berapa kecepatan semua site internet yang ada di surabaya ?')).toBe(true);
    expect(internetAsked('how much bandwidth is the WAN link at Pasuruan using?')).toBe(true);
    expect(internetAsked('jalur ISP mana yang penuh?')).toBe(true);
  });

  it('does not take a question about something else for one', () => {
    expect(internetAsked('tadi malam ada masalah apa di surabaya?')).toBe(false);
    expect(internetAsked('apa IP address 5.1 FGT60F-01-INDIA?')).toBe(false);
  });
});

describe('topicsOf: who dealt with a problem', () => {
  it('finds a question about an acknowledgement or what was written about a problem, in either language', () => {
    expect(topicsOf('siapa yang acknowledge problem ini?').acks).toBe(true);
    expect(topicsOf('who acknowledged the alert at Pasuruan and why?').acks).toBe(true);
    expect(topicsOf('problem ini sudah ditangani belum?').acks).toBe(true);
    expect(topicsOf('ada komentar di problem switch itu?').acks).toBe(true);
  });

  it('does not also ask for the details or the contacts of a host when the question is who acknowledged, and still does for who is in charge', () => {
    const who = topicsOf('siapa yang acknowledge problem di Surabaya?');
    expect([who.acks, who.details, who.people]).toEqual([true, false, false]);
    expect(topicsOf('tadi malam siapa yang acknowledge problem di Surabaya?').past).toBe(false);
    const owner = topicsOf('siapa penanggung jawab di Surabaya?');
    expect([owner.acks, owner.people]).toEqual([false, true]);
  });

  it('does not take an ordinary question for one', () => {
    expect(topicsOf('Ada yang down di Surabaya sekarang?').acks).toBe(false);
    expect(topicsOf('berapa CPU switch 4.3.3 FPSO ARUBA 3?').acks).toBe(false);
  });
});

describe('topicsOf: the SLA', () => {
  it('knows a question about the SLA or the availability', () => {
    expect(topicsOf('berapa SLA bulan September?').sla).toBe(true);
    expect(topicsOf('what was the availability last quarter?').sla).toBe(true);
    expect(topicsOf('ketersediaan jaringan Surabaya minggu lalu?').sla).toBe(true);
  });

  it('does not take another question for one', () => {
    expect(topicsOf('berapa CPU switch itu?').sla).toBe(false);
  });
});

describe('topicsOf: a list of the open problems, and maintenance', () => {
  it('knows a question that asks for the problems as a list', () => {
    expect(topicsOf('sebutkan semua problem di Pasuruan').openAll).toBe(true);
    expect(topicsOf('list all high problems at Surabaya').openAll).toBe(true);
    expect(topicsOf('daftar alert yang masih terbuka').openAll).toBe(true);
  });

  it('does not take a question about a time that has gone, about who acknowledged, or about nothing in particular for one', () => {
    expect(topicsOf('sebutkan semua problem tadi malam').openAll).toBe(false);
    expect(topicsOf('siapa yang acknowledge semua problem?').openAll).toBe(false);
    expect(topicsOf('apa yang perlu diperhatikan sekarang?').openAll).toBe(false);
  });

  it('knows a question about maintenance, in either language', () => {
    expect(topicsOf('ada maintenance terjadwal minggu ini?').maintenance).toBe(true);
    expect(topicsOf('is any scheduled downtime planned?').maintenance).toBe(true);
    expect(topicsOf('jadwal perawatan switch Pasuruan').maintenance).toBe(true);
    expect(topicsOf('berapa CPU switch itu?').maintenance).toBe(false);
  });
});

describe('topicsOf: the WAN links and the web checks', () => {
  it('knows a question about the WAN links, and does not also ask for the ping of a host', () => {
    const t = topicsOf('latency link WAN ke Surabaya berapa?');
    expect(t.links).toBe(true);
    expect(t.metrics).toEqual([]);
    expect(topicsOf('berapa latency ping 5.1 FGT60F-01-INDIA?').metrics).toEqual(['latency']);
    expect(topicsOf('jalur SD-WAN mana yang putus?').links).toBe(true);
    expect(topicsOf('berapa CPU switch itu?').links).toBe(false);
  });

  it('knows a question about the web checks', () => {
    expect(topicsOf('web check mana yang gagal?').web).toBe(true);
    expect(topicsOf('is any website scenario failing?').web).toBe(true);
    expect(topicsOf('berapa CPU switch itu?').web).toBe(false);
  });
});

describe('topicsOf: the course of a value over a time', () => {
  it('knows a question for an average or a trend, and for a peak beside a time', () => {
    expect(topicsOf('rata-rata CPU switch itu kemarin berapa?').series).toBe(true);
    expect(topicsOf('grafik suhu 1.2.11 seminggu terakhir').series).toBe(true);
    expect(topicsOf('CPU tertinggi 1.2.11 minggu ini?').series).toBe(true);
  });

  it('does not take the highest of now, or a question with no metric, for one', () => {
    expect(topicsOf('CPU tertinggi di Surabaya sekarang?').series).toBe(false);
    expect(topicsOf('rata-rata problem per hari?').series).toBe(false);
  });

  it('is not also a question about the problems of that time', () => {
    expect(topicsOf('rata-rata CPU switch itu kemarin berapa?').past).toBe(false);
  });
});

describe('topicsOf: a port', () => {
  it('knows a question that names a port', () => {
    expect(topicsOf('port Gi1/0/12 di switch X up atau down?').port).toBe(true);
    expect(topicsOf('wan2 FGT60F up?').port).toBe(true);
    expect(topicsOf('berapa CPU switch itu?').port).toBe(false);
  });
});

describe('topicsOf: the report pages', () => {
  it('knows a question for each report, in either language', () => {
    expect(topicsOf('host mana yang kapasitasnya hampir penuh?').capacity).toBe(true);
    expect(topicsOf('which alerts are the noisiest?').noise).toBe(true);
    expect(topicsOf('alert apa yang paling berisik minggu ini?').noise).toBe(true);
    expect(topicsOf('trigger paling sering muncul bulan ini?').triggers).toBe(true);
    expect(topicsOf('show the top 10 triggers').triggers).toBe(true);
    expect(topicsOf('berapa persen host yang punya owner? scorecard inventory').inventory).toBe(true);
  });

  it('is not also a question about the problems of that time, and not a report for another question', () => {
    expect(topicsOf('alert apa yang paling berisik minggu ini?').past).toBe(false);
    expect(topicsOf('berapa CPU switch itu?')).toMatchObject({ capacity: false, noise: false, triggers: false, inventory: false, maps: false });
  });
});

describe('topicsOf: the maps', () => {
  it('knows a question about a map or about what a device is connected to', () => {
    expect(topicsOf('apa yang terhubung ke switch X di peta?').maps).toBe(true);
    expect(topicsOf('what is connected to the core switch?').maps).toBe(true);
    expect(topicsOf('show the topology of Pasuruan').maps).toBe(true);
    expect(topicsOf('berapa CPU switch itu?').maps).toBe(false);
  });
});
