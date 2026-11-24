import crypto from 'crypto';
import type express from 'express';

export interface WafIncidentRecord {
  ip: string;
  path: string;
  jenisAncaman: string;
  taktikPengelabuan: string;
  tingkat: 'Rendah' | 'Sedang' | 'Tinggi' | 'Kritis';
}

export interface CloudflareWafRuntimeConfig {
  strictOriginLock: boolean;
  originVerifyHeaderName: string;
  originVerifySecret: string;
  blockHighThreatScore: boolean;
  threatScoreThreshold: number;
}

export interface SecurityMiddlewareOptions {
  allowedMethods?: string[];
  maxUrlLength?: number;
  maxBodyBytes?: number;
  rateLimitReadMax?: number;
  rateLimitWriteMax?: number;
  rateLimitWindowMs?: number;
  autoBanStrikes?: number;
  autoBanWindowMs?: number;
  autoBanDurationMs?: number;
  securityContact?: string;
  /** Paths that intentionally accept attack samples (e.g. AI payload inspector) */
  wafBodyExemptPaths?: string[];
  /** Paths handled by interactive Honeypot traps instead of immediate 404 */
  honeypotPaths?: string[];
  /** Optional dynamic getter for Cloudflare WAF origin lock & threat score rules */
  getCloudflareWafConfig?: () => CloudflareWafRuntimeConfig;
  /** Optional counters callback for WAF telemetry */
  onWafEvent?: (eventType: 'inspected' | 'origin_bypass' | 'threat_score' | 'waf_block') => void;
  onIncident?: (incident: WafIncidentRecord) => void;
}

const BAD_UA =
  /(sqlmap|nikto|nmap|masscan|zgrab|acunetix|nessus|openvas|wpscan|dirbuster|gobuster|ffuf|feroxbuster|wfuzz|hydra|havij|nuclei|metasploit|w3af|arachni|commix|whatweb|netsparker|appscan|qualys)/i;

const PROBE_PATHS =
  /^\/(?:\.env|\.git|\.svn|\.hg|\.ds_store|\.htaccess|\.htpasswd|\.aws|\.ssh|\.dev\.vars|wp-admin|wp-login\.php|wp-content|wp-includes|xmlrpc\.php|phpmyadmin|pma|adminer|cgi-bin|vendor\/phpunit|actuator|server-status|server-info|boot\.ini|etc\/passwd|id_rsa|composer\.(?:json|lock)|package(?:-lock)?\.json|wrangler\.(?:toml|jsonc?))/i;

const WAF_RULES: Array<{ id: string; scope: 'url' | 'all'; re: RegExp }> = [
  { id: 'sqli-union', scope: 'all', re: /\bunion\b[\s\S]{0,40}\bselect\b/i },
  {
    id: 'sqli-tautology',
    scope: 'all',
    re: /['"]\s*(?:or|and)\s+['"]?\w+['"]?\s*=\s*['"]?\w+/i,
  },
  {
    id: 'sqli-destructive',
    scope: 'all',
    re: /(?:\b(?:drop|truncate)\s+table\b|;\s*(?:drop|shutdown)\b)/i,
  },
  {
    id: 'sqli-timing',
    scope: 'all',
    re: /\b(?:sleep|benchmark|pg_sleep|waitfor\s+delay)\s*\(/i,
  },
  {
    id: 'sqli-schema',
    scope: 'all',
    re: /\b(?:information_schema|sqlite_master|xp_cmdshell)\b/i,
  },
  { id: 'xss-script-tag', scope: 'all', re: /<\s*script\b/i },
  { id: 'xss-js-uri', scope: 'all', re: /\bjavascript\s*:/i },
  {
    id: 'xss-event-handler',
    scope: 'all',
    re: /<[^>]{0,200}\bon(?:error|load|click|mouseover|focus|toggle|begin)\s*=/i,
  },
  { id: 'xss-embed', scope: 'all', re: /<\s*(?:iframe|object|embed)\b/i },
  { id: 'xss-cookie', scope: 'all', re: /document\s*\.\s*(?:cookie|write)\b/i },
  {
    id: 'log4shell',
    scope: 'all',
    re: /\$\{\s*(?:jndi|env|sys|lower|upper)\s*:/i,
  },
  {
    id: 'cmd-injection',
    scope: 'all',
    re: /(?:;|\||&&|`|\$\()\s*(?:cat|ls|id|whoami|curl|wget|nc|bash|sh|powershell|cmd)\b/i,
  },
  {
    id: 'template-injection',
    scope: 'all',
    re: /\{\{[^}]{0,100}(?:constructor|__proto__)[^}]{0,100}\}\}/i,
  },
  {
    id: 'path-traversal',
    scope: 'url',
    re: /(?:\.\.[/\\])|(?:etc\/(?:passwd|shadow))|(?:win\.ini)|\u0000/i,
  },
  {
    id: 'ssrf',
    scope: 'url',
    re: /(?:169\.254\.169\.254|metadata\.google\.internal|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i,
  },
];

const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const CSP_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://challenges.cloudflare.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com https://apis.google.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https:",
  "connect-src 'self' https://challenges.cloudflare.com https://script.google.com https://script.googleusercontent.com https://docs.google.com https://sheets.googleapis.com https://*.googleusercontent.com",
  "frame-src 'self' https://challenges.cloudflare.com https://script.google.com https://*.googleusercontent.com https://docs.google.com https://drive.google.com",
  "base-uri 'self'",
  "form-action 'self' https://script.google.com",
  "object-src 'none'",
  "worker-src 'self' blob:",
  'report-uri /__csp-report',
].join('; ');

function decodeLayers(s: string): string {
  let out = s;
  for (let i = 0; i < 2; i++) {
    try {
      const d = decodeURIComponent(out.replace(/\+/g, ' '));
      if (d === out) break;
      out = d;
    } catch {
      break;
    }
  }
  return out;
}

export function inspectWafPayload(
  value: string,
  scope: 'url' | 'all' = 'all'
): string | null {
  for (const rule of WAF_RULES) {
    if (rule.scope === 'url' && scope !== 'url') continue;
    if (rule.re.test(value)) return rule.id;
  }
  return null;
}

function walkJsonForWaf(
  node: unknown,
  out: string[],
  depth = 0
): string | null {
  if (depth > 20) return 'json-too-deep';
  if (out.length > 5000) return null;
  if (typeof node === 'string') {
    out.push(node);
  } else if (Array.isArray(node)) {
    for (const item of node) {
      const hit = walkJsonForWaf(item, out, depth + 1);
      if (hit) return hit;
    }
  } else if (node && typeof node === 'object') {
    for (const key of Object.keys(node as Record<string, unknown>)) {
      if (DANGEROUS_KEYS.has(key)) return 'proto-pollution';
      out.push(key);
      const hit = walkJsonForWaf(
        (node as Record<string, unknown>)[key],
        out,
        depth + 1
      );
      if (hit) return hit;
    }
  }
  return null;
}

export function verifyWebhookHmac(
  secret: string,
  timestamp: string,
  rawBody: string,
  signatureHeader: string
): boolean {
  const sigHex = signatureHeader.replace(/^sha256=/i, '').trim();
  if (!/^[0-9a-f]{64}$/i.test(sigHex)) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex');
  const bufA = Buffer.from(sigHex, 'hex');
  const bufB = Buffer.from(expected, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getClientIp(req: express.Request): string {
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim().length > 0) {
    return cfConnectingIp.trim();
  }
  const trueClientIp = req.headers['true-client-ip'];
  if (typeof trueClientIp === 'string' && trueClientIp.trim().length > 0) {
    return trueClientIp.trim();
  }
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function safeCompareSecret(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createSecurityMiddleware(options: SecurityMiddlewareOptions = {}) {
  const allowedMethods = new Set(
    options.allowedMethods || ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  );
  const maxUrlLength = options.maxUrlLength ?? 4096;
  const rateLimitReadMax = options.rateLimitReadMax ?? 120;
  const rateLimitWriteMax = options.rateLimitWriteMax ?? 30;
  const rateLimitWindowMs = options.rateLimitWindowMs ?? 60_000;
  const autoBanStrikes = options.autoBanStrikes ?? 5;
  const autoBanWindowMs = options.autoBanWindowMs ?? 10 * 60_000;
  const autoBanDurationMs = options.autoBanDurationMs ?? 60 * 60_000;
  const securityContact =
    options.securityContact || 'mailto:walidata@nagekeokab.go.id';
  const wafBodyExempt = new Set(options.wafBodyExemptPaths || []);
  const honeypotSet = new Set(
    (options.honeypotPaths || []).map((p) => p.toLowerCase())
  );

  // In-memory rate limits & auto-ban strikes
  const rateHits = new Map<string, { start: number; count: number }>();
  const strikeMap = new Map<string, { start: number; count: number }>();
  const banMap = new Map<string, { until: number; reason: string }>();

  const checkRate = (ip: string, isWrite: boolean): boolean => {
    const now = Date.now();
    const key = `${isWrite ? 'w' : 'r'}:${ip}`;
    const limit = isWrite ? rateLimitWriteMax : rateLimitReadMax;
    let entry = rateHits.get(key);
    if (!entry || now - entry.start >= rateLimitWindowMs) {
      entry = { start: now, count: 0 };
      rateHits.set(key, entry);
    }
    entry.count++;
    if (rateHits.size > 5000) {
      for (const [k, v] of rateHits) {
        if (now - v.start >= rateLimitWindowMs) rateHits.delete(k);
      }
    }
    return entry.count <= limit;
  };

  const recordStrike = (ip: string, reqPath: string, reason: string) => {
    const now = Date.now();
    let entry = strikeMap.get(ip);
    if (!entry || now - entry.start >= autoBanWindowMs) {
      entry = { start: now, count: 0 };
      strikeMap.set(ip, entry);
    }
    entry.count++;
    if (entry.count >= autoBanStrikes) {
      banMap.set(ip, { until: now + autoBanDurationMs, reason });
      strikeMap.delete(ip);
      options.onIncident?.({
        ip,
        path: reqPath,
        jenisAncaman: `Auto-Ban IP (${reason})`,
        taktikPengelabuan:
          'IP diblokir otomatis selama 60 menit setelah 5 pelanggaran WAF/scanner berturut-turut.',
        tingkat: 'Kritis',
      });
    }
  };

  const logEvent = (
    event: string,
    req: express.Request,
    ip: string,
    extra: Record<string, unknown> = {}
  ) => {
    try {
      console.log(
        JSON.stringify({
          ts: new Date().toISOString(),
          event,
          ip,
          method: req.method,
          path: req.path,
          ...extra,
        })
      );
    } catch {
      // Abaikan
    }
  };

  // Pre-body guard (Cloudflare Edge validation, headers, method, URL, scanner UA, probe paths, rate-limit, security.txt, CSP)
  const preGuard: express.RequestHandler = (req, res, next) => {
    const ip = getClientIp(req);
    const now = Date.now();
    options.onWafEvent?.('inspected');

    // 1. Security Headers (Cloudflare WAF compatible + preserve iframe preview)
    res.removeHeader('X-Powered-By');
    res.removeHeader('Server');
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains'
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()'
    );
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('X-DNS-Prefetch-Control', 'off');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Content-Security-Policy-Report-Only', CSP_POLICY);
    res.setHeader('X-SatuData-WAF', 'cloudflare-ready-active');
    res.setHeader('X-Request-Id', crypto.randomBytes(8).toString('hex'));

    // 1b. Cloudflare Origin Lock & Threat-Score Guard
    const cfConfig = options.getCloudflareWafConfig?.();
    const cfRayHeader = typeof req.headers['cf-ray'] === 'string' ? req.headers['cf-ray'].trim() : '';
    const cfIpHeader =
      typeof req.headers['cf-connecting-ip'] === 'string'
        ? req.headers['cf-connecting-ip'].trim()
        : '';

    if (cfConfig?.strictOriginLock) {
      const headerKey = (cfConfig.originVerifyHeaderName || 'x-cf-origin-verify').toLowerCase();
      const incomingOriginSecret = String(req.headers[headerKey] || '').trim();
      const isLocalLoopback =
        ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
      const hasValidEdgeHeaders =
        Boolean(cfRayHeader && cfIpHeader) &&
        (!cfConfig.originVerifySecret ||
          safeCompareSecret(incomingOriginSecret, cfConfig.originVerifySecret));

      if (!isLocalLoopback && !hasValidEdgeHeaders) {
        options.onWafEvent?.('origin_bypass');
        options.onIncident?.({
          ip,
          path: req.path,
          jenisAncaman: 'Bypass Cloudflare WAF Diblokir (Direct-to-Origin)',
          taktikPengelabuan:
            'Permintaan langsung ke server origin tanpa header Cloudflare Ray / X-CF-Origin-Verify ditolak.',
          tingkat: 'Kritis',
        });
        logEvent('blocked', req, ip, { status: 403, reason: 'cloudflare-origin-lock' });
        return res.status(403).json({
          ok: false,
          error: 'Akses ditolak. Trafik wajib melalui proteksi Cloudflare WAF.',
        });
      }
    }

    if (cfConfig?.blockHighThreatScore) {
      const rawScore = req.headers['cf-threat-score'];
      const threatScore = typeof rawScore === 'string' ? Number(rawScore) : NaN;
      if (Number.isFinite(threatScore) && threatScore >= cfConfig.threatScoreThreshold) {
        options.onWafEvent?.('threat_score');
        options.onIncident?.({
          ip,
          path: req.path,
          jenisAncaman: `Cloudflare Threat Score Tinggi (${threatScore})`,
          taktikPengelabuan:
            'Reputasi IP buruk terdeteksi oleh Cloudflare Edge dan diblokir sebelum memproses aplikasi.',
          tingkat: 'Kritis',
        });
        logEvent('blocked', req, ip, { status: 403, reason: 'cf-threat-score', threatScore });
        return res.status(403).json({
          ok: false,
          error: 'Akses ditolak oleh Cloudflare Threat Intelligence.',
        });
      }
    }

    // 2. /.well-known/security.txt
    if (req.path === '/.well-known/security.txt' && req.method === 'GET') {
      const expires = new Date(now + 365 * 24 * 3600 * 1000).toISOString();
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.status(200).send(
        [
          `Contact: ${securityContact}`,
          `Expires: ${expires}`,
          'Preferred-Languages: id, en',
          `Canonical: ${req.protocol}://${req.get('host')}/.well-known/security.txt`,
          '',
        ].join('\n')
      );
    }

    // 3. CSP violation receiver
    if (req.path === '/__csp-report') {
      if (req.method !== 'POST') return res.status(405).send('Metode tidak diizinkan.');
      logEvent('csp-violation', req, ip);
      return res.status(204).end();
    }

    // 4. Allowed HTTP methods & URL length
    if (!allowedMethods.has(req.method)) {
      res.setHeader('Allow', Array.from(allowedMethods).join(', '));
      return res.status(405).send('Metode tidak diizinkan.');
    }
    if (req.originalUrl.length > maxUrlLength) {
      return res.status(414).send('URL terlalu panjang.');
    }

    // 5. Auto-ban check
    const ban = banMap.get(ip);
    if (ban) {
      if (ban.until > now) {
        logEvent('blocked', req, ip, { status: 403, reason: 'banned-ip' });
        return res.status(403).send('Akses ditolak.');
      }
      banMap.delete(ip);
    }

    // 6. Scanner User-Agent blocker
    const ua = String(req.headers['user-agent'] || '');
    if (BAD_UA.test(ua)) {
      recordStrike(ip, req.path, 'scanner-ua');
      options.onIncident?.({
        ip,
        path: req.path,
        jenisAncaman: `Pemindai Otomatis Diblokir (${ua.slice(0, 40)})`,
        taktikPengelabuan:
          'WAF memblokir User-Agent scanner dan menambah poin pelanggaran auto-ban.',
        tingkat: 'Tinggi',
      });
      logEvent('blocked', req, ip, { status: 403, reason: 'scanner-ua' });
      return res.status(403).send('Akses ditolak.');
    }

    // 7. Reconnaissance probe paths (skip paths explicitly delegated to interactive Honeypot traps)
    const decodedPath = decodeLayers(req.path);
    const pathLower = decodedPath.toLowerCase();
    if (!honeypotSet.has(pathLower) && PROBE_PATHS.test(decodedPath)) {
      recordStrike(ip, req.path, 'probe-path');
      options.onIncident?.({
        ip,
        path: req.path,
        jenisAncaman: `Path Pengintaian Diblokir (${req.path})`,
        taktikPengelabuan:
          'WAF menolak akses ke jalur sensitif dan mencatat strike auto-ban.',
        tingkat: 'Tinggi',
      });
      logEvent('blocked', req, ip, { status: 404, reason: 'probe-path' });
      return res.status(404).send('Halaman tidak ditemukan.');
    }

    // 8. Separate Read/Write Rate Limiter (rate limits do NOT trigger auto-ban for shared office IPs)
    const isWrite = BODY_METHODS.has(req.method);
    if (req.path.startsWith('/api/') && !checkRate(ip, isWrite)) {
      res.setHeader('Retry-After', '60');
      logEvent('blocked', req, ip, { status: 429, reason: 'rate-limit' });
      return res
        .status(429)
        .json({ ok: false, error: 'Terlalu banyak permintaan. Coba lagi sebentar lagi.' });
    }

    // 9. WAF on URL & query string (only for API or non-Vite asset paths)
    if (!req.path.startsWith('/src/') && !req.path.startsWith('/@')) {
      const urlHit = inspectWafPayload(
        `${decodedPath}\n${decodeLayers(req.originalUrl.split('?')[1] || '')}`,
        'url'
      );
      if (urlHit) {
        options.onWafEvent?.('waf_block');
        recordStrike(ip, req.path, `waf:${urlHit}`);
        options.onIncident?.({
          ip,
          path: req.path,
          jenisAncaman: `WAF URL Blokir (${urlHit})`,
          taktikPengelabuan:
            'Payload berbahaya pada URL diblokir WAF sebelum mencapai aplikasi.',
          tingkat: 'Kritis',
        });
        logEvent('waf-hit', req, ip, { rule: urlHit, where: 'url' });
        return res.status(403).send('Akses ditolak.');
      }
    }

    // 10. Log4Shell check on common request headers
    for (const h of ['user-agent', 'referer', 'x-forwarded-for', 'x-api-version']) {
      const val = req.headers[h];
      if (
        typeof val === 'string' &&
        /\$\{\s*(?:jndi|env|sys|lower|upper)\s*:/i.test(decodeLayers(val))
      ) {
        options.onWafEvent?.('waf_block');
        recordStrike(ip, req.path, 'waf:log4shell-header');
        options.onIncident?.({
          ip,
          path: req.path,
          jenisAncaman: 'Serangan Log4Shell pada Header HTTP',
          taktikPengelabuan: 'Header berbahaya diblokir WAF dan strike auto-ban dicatat.',
          tingkat: 'Kritis',
        });
        logEvent('waf-hit', req, ip, { rule: 'log4shell-header', where: 'header' });
        return res.status(403).send('Akses ditolak.');
      }
    }

    if (isWrite) {
      res.setHeader('Cache-Control', 'no-store');
    }

    next();
  };

  // Post-body WAF guard (runs after express.json() so it inspects parsed JSON for SQLi, XSS, cmd injection, prototype pollution)
  const bodyWafGuard: express.RequestHandler = (req, res, next) => {
    if (!BODY_METHODS.has(req.method)) return next();
    if (wafBodyExempt.has(req.path)) return next();
    if (!req.body || typeof req.body !== 'object') return next();

    const ip = getClientIp(req);
    const strings: string[] = [];
    const structuralHit = walkJsonForWaf(req.body, strings);
    if (structuralHit) {
      options.onWafEvent?.('waf_block');
      recordStrike(ip, req.path, `waf:${structuralHit}`);
      options.onIncident?.({
        ip,
        path: req.path,
        jenisAncaman: `WAF Body Blokir (${structuralHit})`,
        taktikPengelabuan:
          'Upaya prototype pollution / JSON berlebih diblokir WAF server.',
        tingkat: 'Kritis',
      });
      logEvent('waf-hit', req, ip, { rule: structuralHit, where: 'body' });
      return res.status(403).json({ ok: false, error: 'Akses ditolak oleh WAF.' });
    }

    for (const s of strings) {
      const hit = inspectWafPayload(decodeLayers(s), 'all');
      if (hit) {
        options.onWafEvent?.('waf_block');
        recordStrike(ip, req.path, `waf:${hit}`);
        options.onIncident?.({
          ip,
          path: req.path,
          jenisAncaman: `WAF Body Blokir (${hit})`,
          taktikPengelabuan:
            'Payload injeksi (SQLi/XSS/Command Injection) pada body diblokir WAF server.',
          tingkat: 'Kritis',
        });
        logEvent('waf-hit', req, ip, { rule: hit, where: 'body' });
        return res
          .status(403)
          .json({ ok: false, error: 'Permintaan ditolak oleh Firewall Aplikasi Web (WAF).' });
      }
    }

    next();
  };

  return { preGuard, bodyWafGuard };
}
