/**
 * Fallout: New Vegas RPG — SillyTavern Extension
 * Tracks S.P.E.C.I.A.L., skills, HP/AP, perks (every 2 levels), reputation, caps
 * for both {{user}} and {{char}} independently.
 *
 * Architecture mirrors Horae: drawer in top nav, per-chat state in chat[0].fnv_rpg,
 * global settings in extension_settings.fnv_rpg, prompt injection via eventSource.
 */

import { renderExtensionTemplateAsync, getContext, extension_settings } from '/scripts/extensions.js';
import { getSlideToggleOptions, saveSettingsDebounced, eventSource, event_types } from '/script.js';
import { slideToggle } from '/lib.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const EXT_NAME     = 'fnv_rpg';
const EXT_FOLDER   = 'third-party/SillyTavern-FNV-RPG';
const TMPL_PATH    = `${EXT_FOLDER}/templates`;
const VERSION      = '1.0.1';

const SPECIAL_DEFS = [
    { key: 'str', name: 'Strength',     abbr: 'STR', desc: 'Carry weight, melee damage, and access to certain perks.' },
    { key: 'per', name: 'Perception',   abbr: 'PER', desc: 'Energy Weapons, Explosives, Lockpick; VATS accuracy.' },
    { key: 'end', name: 'Endurance',    abbr: 'END', desc: 'Hit Points, Poison & Radiation Resistance, Survival.' },
    { key: 'chr', name: 'Charisma',     abbr: 'CHR', desc: 'Barter and Speech; NPC disposition.' },
    { key: 'int', name: 'Intelligence', abbr: 'INT', desc: 'Science, Medicine, Repair; skill points per level.' },
    { key: 'agi', name: 'Agility',      abbr: 'AGI', desc: 'Guns and Sneak; Action Points for VATS.' },
    { key: 'luk', name: 'Luck',         abbr: 'LUK', desc: 'Improves all skills slightly; critical hit chance.' },
];

const SKILL_DEFS = [
    { key: 'barter',        name: 'Barter',         stat: 'chr' },
    { key: 'energyWeapons', name: 'Energy Weapons',  stat: 'per' },
    { key: 'explosives',    name: 'Explosives',      stat: 'per' },
    { key: 'guns',          name: 'Guns',            stat: 'agi' },
    { key: 'lockpick',      name: 'Lockpick',        stat: 'per' },
    { key: 'medicine',      name: 'Medicine',        stat: 'int' },
    { key: 'meleeWeapons',  name: 'Melee Weapons',   stat: 'str' },
    { key: 'repair',        name: 'Repair',          stat: 'int' },
    { key: 'science',       name: 'Science',         stat: 'int' },
    { key: 'sneak',         name: 'Sneak',           stat: 'agi' },
    { key: 'speech',        name: 'Speech',          stat: 'chr' },
    { key: 'survival',      name: 'Survival',        stat: 'end' },
    { key: 'unarmed',       name: 'Unarmed',         stat: 'end' },
];

const REP_LEVELS = ['Idolized', 'Liked', 'Accepted', 'Neutral', 'Shunned', 'Hated', 'Vilified'];

// FNV Perk Catalog — every 2 levels starting at level 2
const PERK_CATALOG = [
    // ── Traits (character creation) ──
    { name: 'Good Natured',       minLv: 1, cat: 'Traits', req: null,          desc: '+5 Barter/Medicine/Repair/Science/Speech. −5 combat skills.' },
    { name: 'Built to Destroy',   minLv: 1, cat: 'Traits', req: null,          desc: '+3% crit chance. Weapon condition degrades 15% faster.' },
    { name: 'Four Eyes',          minLv: 1, cat: 'Traits', req: null,          desc: '+1 PER with glasses; −1 PER without.' },
    { name: 'Small Frame',        minLv: 1, cat: 'Traits', req: null,          desc: '+1 AGI. 25% extra limb damage received.' },
    { name: 'Fast Shot',          minLv: 1, cat: 'Traits', req: null,          desc: '20% faster fire rate with Guns/Energy Weapons; −20% accuracy.' },
    { name: 'Heavy Handed',       minLv: 1, cat: 'Traits', req: null,          desc: '+20% melee/unarmed damage; −60% critical damage.' },
    { name: 'Trigger Discipline', minLv: 1, cat: 'Traits', req: null,          desc: '20% slower fire rate; +20% accuracy with Guns/Energy Weapons.' },
    { name: 'Logan\'s Loophole',  minLv: 1, cat: 'Traits', req: null,          desc: 'Level cap 30. Chems never cause addiction; last 2× longer.' },
    // ── General ──
    { name: 'Intense Training',   minLv: 2,  cat: 'General', req: null,          desc: '+1 to any S.P.E.C.I.A.L. attribute.' },
    { name: 'Swift Learner',      minLv: 2,  cat: 'General', req: 'INT 4',       desc: '+10% XP gained from all sources.' },
    { name: 'Educated',           minLv: 4,  cat: 'General', req: 'INT 4',       desc: '+3 skill points per level up.' },
    { name: 'Comprehension',      minLv: 4,  cat: 'General', req: 'INT 4',       desc: 'Skill books give +2 instead of +1.' },
    { name: 'Night Person',       minLv: 2,  cat: 'General', req: null,          desc: '+2 INT and +2 PER between 6 PM–6 AM.' },
    { name: 'Pack Rat',           minLv: 8,  cat: 'General', req: 'END 5',       desc: 'Small items weigh 50% less.' },
    { name: 'Strong Back',        minLv: 8,  cat: 'General', req: 'STR 5, END 5',desc: '+50 lbs carry weight.' },
    { name: 'Tag!',               minLv: 8,  cat: 'General', req: null,          desc: 'Tag an additional skill (+15).' },
    { name: 'Retention',          minLv: 4,  cat: 'General', req: 'INT 7',       desc: 'Skill books permanently increase skill by +3.' },
    { name: 'Heave, Ho!',         minLv: 2,  cat: 'General', req: 'STR 5',       desc: 'Thrown weapons have more velocity and range.' },
    // ── Combat ──
    { name: 'Rapid Reload',       minLv: 2,  cat: 'Combat',  req: 'AGI 5',       desc: 'Reload speed for all guns +25%.' },
    { name: 'Gunslinger',         minLv: 6,  cat: 'Combat',  req: 'AGI 6',       desc: '+25% accuracy with one-handed firearms in VATS.' },
    { name: 'Commando',           minLv: 8,  cat: 'Combat',  req: 'AGI 4',       desc: '+25% accuracy with two-handed firearms in VATS.' },
    { name: 'Finesse',            minLv: 10, cat: 'Combat',  req: null,          desc: '+5% critical hit chance.' },
    { name: 'Better Criticals',   minLv: 16, cat: 'Combat',  req: 'PER 6, LUK 6',desc: 'Critical hits deal 50% more damage.' },
    { name: 'Sniper',             minLv: 12, cat: 'Combat',  req: 'AGI 6, PER 6',desc: 'Scoring a critical hit while sniping is much more likely.' },
    { name: 'Bloody Mess',        minLv: 6,  cat: 'Combat',  req: null,          desc: '+5% overall damage dealt.' },
    { name: 'Toughness',          minLv: 6,  cat: 'Combat',  req: 'END 5',       desc: '+3 to Damage Threshold.' },
    { name: 'Stonewall',          minLv: 8,  cat: 'Combat',  req: 'STR 6, END 6',desc: 'You cannot be knocked down in combat.' },
    { name: 'Math Wrath',         minLv: 10, cat: 'Combat',  req: 'Science 70',  desc: 'VATS AP costs reduced by 10%.' },
    { name: 'Run \'n\' Gun',      minLv: 8,  cat: 'Combat',  req: 'Guns 45',     desc: 'Move at normal speed using pistols and SMGs.' },
    { name: 'Spray and Pray',     minLv: 12, cat: 'Combat',  req: null,          desc: 'Companions take 80% less damage from your area-effect weapons.' },
    { name: 'Hit the Deck',       minLv: 8,  cat: 'Combat',  req: 'AGI 6',       desc: '+25 DT against explosive weapons.' },
    { name: 'Piercing Strike',    minLv: 12, cat: 'Combat',  req: 'Unarmed 70',  desc: 'Unarmed and melee attacks ignore enemy DT.' },
    { name: 'Weapon Handling',    minLv: 10, cat: 'Combat',  req: 'END 6',       desc: 'Weapon STR requirements reduced by 2.' },
    { name: 'Demolition Expert',  minLv: 6,  cat: 'Combat',  req: 'Explosives 50',desc: '+25% damage with all explosives.' },
    { name: 'Light Touch',        minLv: 6,  cat: 'Combat',  req: 'AGI 6',       desc: '+5% critical hit chance in light armor.' },
    { name: 'Living Anatomy',     minLv: 8,  cat: 'Combat',  req: 'Medicine 70', desc: '+5% damage to humans and non-feral ghouls.' },
    { name: 'Silent Running',     minLv: 12, cat: 'Combat',  req: 'AGI 6, Sneak 50', desc: 'Run without penalty to Sneak.' },
    // ── Survival ──
    { name: 'Cannibal',           minLv: 4,  cat: 'Survival',req: null,          desc: 'Eat human corpses to restore Hit Points.' },
    { name: 'Life Giver',         minLv: 12, cat: 'Survival',req: 'END 6',       desc: '+30 max Hit Points.' },
    { name: 'Chem Resistant',     minLv: 16, cat: 'Survival',req: 'Medicine 60', desc: '50% less likely to develop chem addictions.' },
    { name: 'Chemist',            minLv: 14, cat: 'Survival',req: 'Medicine 60', desc: 'Chems last twice as long.' },
    { name: 'Rad Absorption',     minLv: 12, cat: 'Survival',req: 'END 7',       desc: 'Slowly regenerate from radiation poisoning.' },
    { name: 'Travel Light',       minLv: 6,  cat: 'Survival',req: 'Survival 45', desc: 'Move 10% faster in light or no armor.' },
    { name: 'Pack Animal',        minLv: 4,  cat: 'Survival',req: 'STR 6',       desc: '+50 lbs carry weight from pack animal companions.' },
    { name: 'Them\'s Good Eatin\'',minLv: 6, cat: 'Survival',req: 'Survival 55', desc: 'Any corpse you eat has a 25% chance to give a Thin Red Paste.' },
    // ── Social ──
    { name: 'Lady Killer',        minLv: 2,  cat: 'Social',  req: null,          desc: '+10% damage against females; unique dialogue with women.' },
    { name: 'Black Widow',        minLv: 2,  cat: 'Social',  req: null,          desc: '+10% damage against males; unique dialogue with men.' },
    { name: 'Confirmed Bachelor', minLv: 2,  cat: 'Social',  req: null,          desc: '+10% damage against males; unique dialogue options.' },
    { name: 'Cherchez La Femme',  minLv: 2,  cat: 'Social',  req: null,          desc: '+10% damage against females; unique dialogue options.' },
    { name: 'Terrifying Presence',minLv: 6,  cat: 'Social',  req: 'Speech 70',   desc: 'Unlocks intimidating dialogue options.' },
    { name: 'Ferocious Loyalty',  minLv: 6,  cat: 'Social',  req: 'CHR 6',       desc: 'When HP drops below 50%, companions gain +100 DT.' },
    { name: 'Animal Friend',      minLv: 10, cat: 'Social',  req: 'CHR 6',       desc: 'Animals will not attack you unless provoked.' },
    // ── Exploration ──
    { name: 'Fortune Finder',     minLv: 6,  cat: 'Exploration',req: null,       desc: 'Find more bottle caps in containers.' },
    { name: 'Scrounger',          minLv: 8,  cat: 'Exploration',req: null,       desc: 'Find more ammunition in containers.' },
    { name: 'Jury Rigging',       minLv: 14, cat: 'Exploration',req: 'Repair 90',desc: 'Repair any item using a similar category item.' },
    { name: 'Nerd Rage!',         minLv: 10, cat: 'Exploration',req: 'INT 5',    desc: 'When HP drops below 20%: +50 DT, +20% damage.' },
];

// ── Perk stat effects ────────────────────────────────────────────────────────
// Numeric bonuses stacked from all active perks. Skills (Good Natured) are
// applied directly to stored char.skills when the perk is added/removed.
const PERK_EFFECTS = {
    'Toughness':     { dt: 3 },
    'Life Giver':    { maxHp: 30 },
    'Strong Back':   { carryWt: 50 },
    'Pack Rat':      { carryWt: 25 },
    'Pack Animal':   { carryWt: 50 },
    'Finesse':       { critPct: 5 },
    'Light Touch':   { critPct: 5 },
    'Swift Learner': { xpMult: 10 },
    'Educated':      { skillRate: 3 },
    'Good Natured':  { skills: { barter: 5, medicine: 5, repair: 5, science: 5, speech: 5,
                                  energyWeapons: -5, explosives: -5, guns: -5, meleeWeapons: -5, unarmed: -5 } },
};

// ── Formulas ──────────────────────────────────────────────────────────────────

const xpToNextLevel = (lv) => lv * 200;
const totalXpForLevel = (lv) => lv <= 1 ? 0 : 100 * (lv - 1) * lv;

function levelFromXp(xp) {
    let lv = 1;
    while (lv < 30 && totalXpForLevel(lv + 1) <= xp) lv++;
    return lv;
}

const calcMaxHP = (sp, lv) => Math.max(1, 95 + (sp.end - 5) * 20 + (lv - 1) * 5);
const calcMaxAP = (sp)      => Math.max(1, 65 + sp.agi * 2);
const calcSkillBase = (def, sp) => 2 + 2 * sp[def.stat] + Math.floor(sp.luk / 2);
const calcCarryWt  = (sp)   => 150 + sp.str * 10;
const calcCritPct  = (sp)   => (sp.luk * 0.5).toFixed(1);
const calcMeleeDmg = (sp)   => ((sp.str - 5) * 0.5).toFixed(1);
const calcSkillRate = (sp)  => 10 + sp.int * 2;

// Available perk points = floor(level / 2)  (perk every 2 levels, starting at lv 2)
const availablePerkPts = (lv) => Math.floor(lv / 2);
const pendingPerkPts   = (char) => Math.max(0, availablePerkPts(char.level) - char.perks.length);

function getPerkBonuses(char) {
    const b = { dt: 0, maxHp: 0, carryWt: 0, critPct: 0, xpMult: 0, skillRate: 0 };
    for (const name of (char.perks || [])) {
        const fx = PERK_EFFECTS[name];
        if (!fx) continue;
        if (fx.dt)        b.dt        += fx.dt;
        if (fx.maxHp)     b.maxHp     += fx.maxHp;
        if (fx.carryWt)   b.carryWt   += fx.carryWt;
        if (fx.critPct)   b.critPct   += fx.critPct;
        if (fx.xpMult)    b.xpMult    += fx.xpMult;
        if (fx.skillRate) b.skillRate  += fx.skillRate;
    }
    return b;
}

// ── Default data ──────────────────────────────────────────────────────────────

function createDefaultChar(name = '') {
    const special = { str: 5, per: 5, end: 5, chr: 5, int: 5, agi: 5, luk: 5 };
    return {
        name,
        level: 1,
        xp: 0,
        karma: 'Neutral',
        special,
        hp:  { current: 95, max: 95 },
        ap:  { current: 75, max: 75 },
        dt:  0,
        skills: Object.fromEntries(SKILL_DEFS.map(d => [d.key, calcSkillBase(d, special)])),
        tagSkills: [],
        perks: [],
        caps: 0,
        reputation: {},
        notes: '',
        skillPoints: 0,
        perkDescs: {},
    };
}

function createDefaultChatData() {
    return {
        user: createDefaultChar('The Courier'),
        char: createDefaultChar(''),
        trackUser: true,
        trackChar: true,
    };
}

// ── Global state ──────────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = { enabled: true, injectContext: true, injectionPosition: 1, xpRate: 'medium', injectPerkDescs: false };

let settings  = { ...DEFAULT_SETTINGS };
let chatData  = createDefaultChatData();
let activeChar = 'user';   // 'user' | 'char' — which card is being edited
let catalogOpen = false;
const expandedPerkCats = new Set();
let doNavbarIconClick = null;

// ── Settings I/O ──────────────────────────────────────────────────────────────

function loadSettings() {
    settings = extension_settings[EXT_NAME]
        ? { ...DEFAULT_SETTINGS, ...extension_settings[EXT_NAME] }
        : { ...DEFAULT_SETTINGS };
    extension_settings[EXT_NAME] = { ...settings };
}

function saveSettings() {
    extension_settings[EXT_NAME] = { ...settings };
    saveSettingsDebounced();
}

// ── Per-message snapshot system ───────────────────────────────────────────────
// Each AI message stores a full chatData snapshot in msg.extra.fnv_rpg.
// Current state = last visible AI message's snapshot (time-travel safe).

function saveSnapshot(messageId) {
    const ctx = getContext();
    if (!ctx?.chat?.[messageId]) return;
    const msg = ctx.chat[messageId];
    if (msg.is_user) return;
    msg.extra = msg.extra || {};
    msg.extra.fnv_rpg = JSON.parse(JSON.stringify(chatData));
}

function loadFromLastSnapshot() {
    const ctx = getContext();
    if (!ctx?.chat) return false;
    for (let i = ctx.chat.length - 1; i >= 0; i--) {
        const msg = ctx.chat[i];
        if (!msg.is_user && msg.extra?.fnv_rpg) {
            const saved = msg.extra.fnv_rpg;
            chatData = {
                user: deepMergeChar(saved.user || {}, createDefaultChar('The Courier')),
                char: deepMergeChar(saved.char || {}, createDefaultChar('')),
                trackUser: saved.trackUser !== false,
                trackChar: saved.trackChar !== false,
            };
            return true;
        }
    }
    return false;
}

// ── Per-chat character I/O ────────────────────────────────────────────────────

function deepMergeChar(saved, defaults) {
    const result = { ...defaults, ...saved };
    result.special    = { ...defaults.special,    ...(saved.special    || {}) };
    result.hp         = { ...defaults.hp,         ...(saved.hp         || {}) };
    result.ap         = { ...defaults.ap,         ...(saved.ap         || {}) };
    result.skills     = { ...defaults.skills,     ...(saved.skills     || {}) };
    result.tagSkills   = Array.isArray(saved.tagSkills) ? [...saved.tagSkills] : [];
    result.perks       = Array.isArray(saved.perks)     ? [...saved.perks]     : [];
    result.reputation  = { ...(saved.reputation || {}) };
    result.skillPoints = saved.skillPoints ?? 0;
    result.perkDescs   = { ...(saved.perkDescs || {}) };
    return result;
}

function loadChatData() {
    const ctx = getContext();
    if (!ctx?.chat?.length) { chatData = createDefaultChatData(); return; }
    // Snapshots are authoritative (time-travel safe); fall back to legacy chat[0].fnv_rpg
    if (loadFromLastSnapshot()) return;
    const saved = ctx.chat[0].fnv_rpg;
    if (!saved) { chatData = createDefaultChatData(); return; }
    chatData = {
        user: deepMergeChar(saved.user || {}, createDefaultChar('The Courier')),
        char: deepMergeChar(saved.char || {}, createDefaultChar('')),
        trackUser: saved.trackUser !== false,
        trackChar: saved.trackChar !== false,
    };
}

function saveChatData() {
    const ctx = getContext();
    if (!ctx?.chat?.length) return;
    ctx.chat[0].fnv_rpg = JSON.parse(JSON.stringify(chatData));
    // Mirror to last AI message so manual edits are reflected in snapshot time-travel
    for (let i = ctx.chat.length - 1; i >= 0; i--) {
        if (ctx.chat[i].is_user === false) {
            ctx.chat[i].extra = ctx.chat[i].extra || {};
            ctx.chat[i].extra.fnv_rpg = JSON.parse(JSON.stringify(chatData));
            break;
        }
    }
    ctx.saveChat();
}

// ── Derived stats sync ────────────────────────────────────────────────────────

function syncDerived(char) {
    const bonuses = getPerkBonuses(char);
    const newMaxHP = calcMaxHP(char.special, char.level) + bonuses.maxHp;
    const newMaxAP = calcMaxAP(char.special);
    if (char.hp.max !== newMaxHP) {
        char.hp.current = Math.min(newMaxHP, Math.max(1, Math.round(char.hp.current * newMaxHP / (char.hp.max || 1))));
        char.hp.max = newMaxHP;
    }
    if (char.ap.max !== newMaxAP) {
        char.ap.current = Math.min(newMaxAP, char.ap.current);
        char.ap.max = newMaxAP;
    }
}

// Helper
const cur = () => chatData[activeChar];

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildCharPrompt(role, char) {
    const sp      = char.special;
    const xpGap   = xpToNextLevel(char.level);
    const xpProg  = char.xp - totalXpForLevel(char.level);
    const xpP     = xpGap > 0 ? Math.round(xpProg / xpGap * 100) : 100;
    const hpP     = char.hp.max > 0 ? Math.round(char.hp.current / char.hp.max * 100) : 0;
    const bonuses = getPerkBonuses(char);
    const effectiveDT = char.dt + bonuses.dt;

    const lines = [];
    lines.push(`=== ${role.toUpperCase()}: ${char.name.toUpperCase() || '(unnamed)'} ===`);
    lines.push(`Level ${char.level}  |  XP: ${xpProg}/${xpGap} (${xpP}%)  |  Karma: ${char.karma}`);
    lines.push('');
    lines.push('── VITALS ──');
    lines.push(`HP: ${char.hp.current}/${char.hp.max} (${hpP}%)  |  AP: ${char.ap.current}/${char.ap.max}  |  DT: ${effectiveDT}  |  Caps: ${char.caps}`);
    lines.push('');
    lines.push('── S.P.E.C.I.A.L. ──');
    lines.push(SPECIAL_DEFS.map(d => `${d.abbr} ${sp[d.key]}`).join('  |  '));
    lines.push('');
    lines.push('── SKILLS ──');
    const skillStrs = SKILL_DEFS.map(d => {
        const val = char.skills[d.key] ?? 0;
        return `${d.name}${char.tagSkills.includes(d.key) ? '★' : ''}: ${val}`;
    });
    for (let i = 0; i < skillStrs.length; i += 4) {
        lines.push(skillStrs.slice(i, i + 4).join('  |  '));
    }
    if (char.perks.length > 0) {
        lines.push('');
        lines.push('── PERKS ──');
        if (settings.injectPerkDescs) {
            lines.push(char.perks.map(p => {
                const entry = PERK_CATALOG.find(pc => pc.name === p);
                const desc = entry?.desc || char.perkDescs?.[p] || '';
                return desc ? `${p} (${desc})` : p;
            }).join('\n'));
        } else {
            lines.push(char.perks.join(', '));
        }
    }
    const repEntries = Object.entries(char.reputation).filter(([, v]) => v && v !== 'Neutral');
    if (repEntries.length > 0) {
        lines.push('');
        lines.push('── REPUTATION ──');
        lines.push(repEntries.map(([k, v]) => `${k}: ${v}`).join('  |  '));
    }
    if (char.notes?.trim()) {
        lines.push('');
        lines.push('── NOTES ──');
        lines.push(char.notes.trim());
    }
    return lines.join('\n');
}

function buildPrompt() {
    if (!settings.enabled) return '';
    const parts = [];
    if (chatData.trackUser && chatData.user.name) parts.push(buildCharPrompt('Player Character', chatData.user));
    if (chatData.trackChar)                       parts.push(buildCharPrompt('Character', chatData.char));
    if (parts.length === 0) return '';
    return [
        '<fnvrpg>',
        ...parts,
        '',
        '── ROLEPLAY GUIDELINES ──',
        'Use this character sheet to guide the narrative. Higher skill (75+) = reliable success; 50–74 = moderate; <50 = difficult. Track HP when injured or healed. Reference reputation when NPCs react. Caps matter for prices and bribes. Tagged skills (★) are specialties.',
        '',
        '── AUTO-STAT TRACKING (REQUIRED) ──',
        'At the END of EVERY response, append a <fnvstat> block listing all stat changes that occurred in the scene.',
        'Format: one line per character with prefix "player:" or "char:", then space-separated key:value pairs.',
        '  hp:±N   ap:±N   xp:+N   caps:±N   rep.FactionName:Level   karma:Good|Neutral|Evil',
        'Rep levels (ordered): Idolized / Liked / Accepted / Neutral / Shunned / Hated / Vilified',
        'Use underscores for multi-word faction names (e.g. rep.Caesars_Legion:Liked).',
        'Write the single word "none" inside the block if nothing changed.',
        ...(settings.xpRate === 'none'
            ? ['XP rule: Do NOT award any XP. Omit xp from every <fnvstat> block.']
            : settings.xpRate === 'ai'
            ? []
            : settings.xpRate === 'low'
            ? ['XP rule: Be conservative — 5 to 30 XP per response. Only for meaningful combat wins, key dialogue, or clear story milestones.']
            : settings.xpRate === 'high'
            ? ['XP rule: Be generous — 75 to 250 XP per response. Reward most interactions, exploration, and roleplay moments.']
            : ['XP rule: Be moderate — 25 to 100 XP per response for any notable action, combat encounter, or story advancement.']),
        'Example of a fight where the player took damage, earned XP, and spent caps:',
        '<fnvstat>',
        'player: hp:-20 xp:+75 caps:-50 rep.NCR:Liked',
        'char: hp:-10',
        '</fnvstat>',
        '</fnvrpg>',
    ].join('\n');
}

// ── Regex rule ────────────────────────────────────────────────────────────────

function ensureRegexRule() {
    if (!extension_settings.regex) extension_settings.regex = [];
    const RULE = {
        id: 'fnvrpg_hide', scriptName: 'FNV-RPG - Hide stat tags',
        description: 'Hides <fnvrpg> character sheet tags from display',
        findRegex: '/<fnvrpg>[\\s\\S]*?<\\/fnvrpg>/gim',
        replaceString: '', trimStrings: [], placement: [2],
        disabled: false, markdownOnly: true, promptOnly: true,
        runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
    };
    const idx = extension_settings.regex.findIndex(r => r.id === RULE.id);
    if (idx !== -1) {
        const userDisabled = extension_settings.regex[idx].disabled;
        extension_settings.regex.splice(idx, 1);
        extension_settings.regex.push({ ...RULE, disabled: userDisabled });
    } else {
        extension_settings.regex.push({ ...RULE });
    }
    saveSettingsDebounced();
}

// ── Regex rules ───────────────────────────────────────────────────────────────

function ensureStatRegexRule() {
    if (!extension_settings.regex) extension_settings.regex = [];
    const RULE = {
        id: 'fnvrpg_stat_hide', scriptName: 'FNV-RPG - Hide stat update tags',
        description: 'Hides <fnvstat> auto-update blocks from chat display',
        findRegex: '/<fnvstat>[\\s\\S]*?<\\/fnvstat>/gim',
        replaceString: '', trimStrings: [], placement: [2],
        disabled: false, markdownOnly: true, promptOnly: true,
        runOnEdit: true, substituteRegex: 0, minDepth: null, maxDepth: null,
    };
    const idx = extension_settings.regex.findIndex(r => r.id === RULE.id);
    if (idx !== -1) {
        const userDisabled = extension_settings.regex[idx].disabled;
        extension_settings.regex.splice(idx, 1);
        extension_settings.regex.push({ ...RULE, disabled: userDisabled });
    } else {
        extension_settings.regex.push({ ...RULE });
    }
    saveSettingsDebounced();
}

// ── ST Event hooks ────────────────────────────────────────────────────────────

async function onPromptReady(eventData) {
    if (!settings.enabled || !settings.injectContext || eventData?.dryRun) return;
    try {
        const prompt = buildPrompt();
        if (!prompt) return;
        const pos = settings.injectionPosition;
        if (pos === 0) eventData.chat.push({ role: 'system', content: prompt });
        else           eventData.chat.splice(-pos, 0, { role: 'system', content: prompt });
    } catch (err) {
        console.error('[FNV-RPG] Prompt injection failed:', err);
    }
}

function onChatChanged() {
    loadChatData();
    try {
        const ctx = getContext();
        if (ctx?.name2 && !chatData.char.name) chatData.char.name = ctx.name2;
    } catch (_) {}
    refreshUI();
    setTimeout(reinjectAllPanels, 200);
}

function onStructureChanged() {
    loadChatData();
    try {
        const ctx = getContext();
        if (ctx?.name2 && !chatData.char.name) chatData.char.name = ctx.name2;
    } catch (_) {}
    refreshUI();
    setTimeout(reinjectAllPanels, 150);
}

// ── Auto-parse AI stat updates (Horae-style) ─────────────────────────────────

function applyStatUpdates(charKey, updates) {
    const char = chatData[charKey];
    if (!char) return false;
    let changed = false, leveledUp = false;

    for (const [key, value] of Object.entries(updates)) {
        if (key === 'hp') {
            char.hp.current = Math.max(0, Math.min(char.hp.max, char.hp.current + value));
            changed = true;
        } else if (key === 'ap') {
            char.ap.current = Math.max(0, Math.min(char.ap.max, char.ap.current + value));
            changed = true;
        } else if (key === 'xp') {
            const xpBonuses = getPerkBonuses(char);
            const effectiveXp = value > 0 ? Math.round(value * (1 + xpBonuses.xpMult / 100)) : value;
            char.xp = Math.max(0, char.xp + effectiveXp);
            while (char.level < 30 && char.xp >= totalXpForLevel(char.level + 1)) {
                char.level++;
                syncDerived(char);
                const lvBonuses = getPerkBonuses(char);
                char.skillPoints = (char.skillPoints || 0) + calcSkillRate(char.special) + lvBonuses.skillRate;
                leveledUp = true;
            }
            changed = true;
        } else if (key === 'caps') {
            char.caps = Math.max(0, char.caps + value);
            changed = true;
        } else if (key === 'karma') {
            if (['Good', 'Neutral', 'Evil'].includes(value)) { char.karma = value; changed = true; }
        } else if (key.startsWith('rep.')) {
            const faction = key.slice(4);
            if (REP_LEVELS.includes(value)) { char.reputation[faction] = value; changed = true; }
        }
    }

    if (leveledUp) {
        const pending = pendingPerkPts(char);
        const label = charKey === 'user' ? 'Player' : 'Character';
        showToast(`${label} leveled up to Level ${char.level}! ${pending} perk point(s) available.`, 'success');
        showLevelUpBadge();
    }
    return changed;
}

function parseStatBlock(content) {
    const lines = content.split('\n').map(l => l.trim()).filter(l => l && l.toLowerCase() !== 'none');
    let anyChange = false;

    for (const line of lines) {
        let charKey = 'user';
        let statStr = line;

        const prefixMatch = line.match(/^(player|char)\s*:\s*/i);
        if (prefixMatch) {
            charKey = prefixMatch[1].toLowerCase() === 'char' ? 'char' : 'user';
            statStr = line.slice(prefixMatch[0].length);
        }

        const updates = {};
        const tokenRe = /(\S+?):([+\-]?\d+|[A-Za-z]\w*)/g;
        let m;
        while ((m = tokenRe.exec(statStr)) !== null) {
            const rawKey = m[1].toLowerCase();
            const rawVal = m[2];
            if (['hp', 'ap', 'xp', 'caps'].includes(rawKey)) {
                const num = parseInt(rawVal);
                if (!isNaN(num)) updates[rawKey] = num;
            } else if (rawKey === 'karma') {
                const karma = rawVal.charAt(0).toUpperCase() + rawVal.slice(1).toLowerCase();
                updates[rawKey] = karma;
            } else if (rawKey.startsWith('rep.')) {
                const faction = rawKey.slice(4).replace(/_/g, ' ');
                const repVal = rawVal.charAt(0).toUpperCase() + rawVal.slice(1).toLowerCase();
                updates['rep.' + faction] = repVal;
            }
        }

        if (Object.keys(updates).length > 0) {
            if (applyStatUpdates(charKey, updates)) anyChange = true;
        }
    }
    return anyChange;
}

function onMessageReceived(messageId) {
    if (!settings.enabled) return;
    try {
        const ctx = getContext();
        if (!ctx?.chat?.length) return;

        // Resolve the message — prefer the specific messageId, fall back to last AI message
        let resolvedId = messageId;
        let messageText = null;
        if (messageId !== undefined && messageId !== null) {
            const msg = ctx.chat[messageId];
            if (msg && msg.is_user === false) messageText = msg.mes;
        }
        if (!messageText) {
            for (let i = ctx.chat.length - 1; i >= 0; i--) {
                if (ctx.chat[i].is_user === false) {
                    messageText = ctx.chat[i].mes;
                    resolvedId  = i;
                    break;
                }
            }
        }
        if (!messageText) return;

        // Parse stat updates
        const match = messageText.match(/<fnvstat>([\s\S]*?)<\/fnvstat>/i);
        if (match) {
            const changed = parseStatBlock(match[1]);
            if (changed) {
                saveSnapshot(resolvedId);
                saveChatData();
                refreshUI();
                showToast('Stats updated.', 'info');
            } else {
                saveSnapshot(resolvedId);
                saveChatData();
            }
        } else {
            // No stat block — snapshot current state so this message acts as a restore point
            saveSnapshot(resolvedId);
            saveChatData();
        }

        // Always inject stat HUD on AI messages
        injectMsgPanel(resolvedId);
    } catch (err) {
        console.error('[FNV-RPG] Stat parse error:', err);
    }
}

// ── In-message stat HUD ───────────────────────────────────────────────────────

function buildMsgStatsHtml(data) {
    if (!settings.enabled) return '';
    data = data || chatData;

    const renderChar = (char, role) => {
        if (!char) return '';
        const hpPct  = char.hp.max > 0 ? Math.max(0, Math.min(100, char.hp.current / char.hp.max * 100)) : 0;
        const apPct  = char.ap.max > 0 ? Math.max(0, Math.min(100, char.ap.current / char.ap.max * 100)) : 0;
        const xpNext = xpToNextLevel(char.level);
        const xpProg = char.xp - totalXpForLevel(char.level);
        const xpPct  = xpNext > 0 ? Math.max(0, Math.min(100, xpProg / xpNext * 100)) : 100;
        const hpCls  = hpPct > 50 ? '' : hpPct > 25 ? 'warn' : 'crit';

        const repTags = Object.entries(char.reputation || {})
            .filter(([, v]) => v && v !== 'Neutral')
            .slice(0, 4)
            .map(([f, v]) => `<span class="fnvrpg-msg-rep-tag r-${v.toLowerCase()}">${escHtml(f)}: ${v}</span>`)
            .join('');

        const footer = `<span class="fnvrpg-msg-caps"><i class="fa-solid fa-coins" style="font-size:9px"></i> ${char.caps}</span>${repTags}`;

        return `<div class="fnvrpg-msg-char-block">
            <div class="fnvrpg-msg-char-header">
                <span class="fnvrpg-msg-role">${role === 'user' ? 'PLAYER' : 'CHAR'}</span>
                <span class="fnvrpg-msg-name">${escHtml(char.name || '—')}</span>
                <span class="fnvrpg-msg-lvl">Lv.${char.level} · ${char.karma}</span>
            </div>
            <div class="fnvrpg-msg-bar-row">
                <span class="fnvrpg-msg-bar-lbl">HP</span>
                <div class="fnvrpg-msg-track"><div class="fnvrpg-msg-fill fnvrpg-fill-hp ${hpCls}" style="width:${hpPct.toFixed(1)}%"></div></div>
                <span class="fnvrpg-msg-bar-val">${char.hp.current}/${char.hp.max}</span>
            </div>
            <div class="fnvrpg-msg-bar-row">
                <span class="fnvrpg-msg-bar-lbl">AP</span>
                <div class="fnvrpg-msg-track"><div class="fnvrpg-msg-fill fnvrpg-fill-ap" style="width:${apPct.toFixed(1)}%"></div></div>
                <span class="fnvrpg-msg-bar-val">${char.ap.current}/${char.ap.max}</span>
            </div>
            <div class="fnvrpg-msg-bar-row">
                <span class="fnvrpg-msg-bar-lbl">XP</span>
                <div class="fnvrpg-msg-track"><div class="fnvrpg-msg-fill fnvrpg-fill-xp" style="width:${xpPct.toFixed(1)}%"></div></div>
                <span class="fnvrpg-msg-bar-val">${xpProg}/${xpNext}</span>
            </div>
            <div class="fnvrpg-msg-footer">${footer}</div>
        </div>`;
    };

    const parts = [];
    if (data.trackUser && data.user?.name) parts.push(renderChar(data.user, 'user'));
    if (data.trackChar && data.char)       parts.push(renderChar(data.char, 'char'));
    if (parts.length === 0) return '';
    return `<div class="fnvrpg-msg-stats">${parts.join('')}</div>`;
}

function injectMsgPanel(mesId) {
    if (!settings.enabled) return;
    const ctx = getContext();
    const snapshot = ctx?.chat?.[mesId]?.extra?.fnv_rpg || chatData;
    const html = buildMsgStatsHtml(snapshot);
    if (!html) return;
    const $msg = $(`.mes[mesid="${mesId}"]`);
    if (!$msg.length) return;
    $msg.find('.fnvrpg-msg-stats').remove();
    $msg.find('.mes_text').after(html);
}

function refreshMsgPanels() {
    if (!settings.enabled) { $('.fnvrpg-msg-stats').remove(); return; }
    const ctx = getContext();
    $('.mes[is_user="false"]').each(function () {
        const $panel = $(this).find('.fnvrpg-msg-stats');
        if ($panel.length === 0) return;
        const mesId = parseInt($(this).attr('mesid'));
        if (isNaN(mesId)) return;
        const snapshot = ctx?.chat?.[mesId]?.extra?.fnv_rpg || chatData;
        const newHtml = buildMsgStatsHtml(snapshot);
        if (!newHtml) { $panel.remove(); return; }
        $panel.html($(newHtml).html());
    });
}

function reinjectAllPanels() {
    $('.fnvrpg-msg-stats').remove();
    if (!settings.enabled) return;
    $('.mes[is_user="false"]').each(function () {
        const mesId = parseInt($(this).attr('mesid'));
        if (!isNaN(mesId)) injectMsgPanel(mesId);
    });
}

// ── Drawer open/close ─────────────────────────────────────────────────────────

function isNewNavbar() { return typeof doNavbarIconClick === 'function'; }

async function initNavbar() {
    try {
        const m = await import('/script.js');
        if (m.doNavbarIconClick) doNavbarIconClick = m.doNavbarIconClick;
    } catch (_) {}
}

function openDrawerLegacy() {
    const $icon = $('#fnvrpg_drawer_icon'), $content = $('#fnvrpg_drawer_content');
    if ($icon.hasClass('closedIcon')) {
        $('.openDrawer').not('#fnvrpg_drawer_content').not('.pinnedOpen').addClass('resizing').each((_, el) => {
            slideToggle(el, { ...getSlideToggleOptions(), onAnimationEnd: e => e.closest?.('.drawer-content')?.classList.remove('resizing') });
        });
        $('.openIcon').not('#fnvrpg_drawer_icon').not('.drawerPinnedOpen').toggleClass('closedIcon openIcon');
        $('.openDrawer').not('#fnvrpg_drawer_content').not('.pinnedOpen').toggleClass('closedDrawer openDrawer');
        $icon.toggleClass('closedIcon openIcon');
        $content.toggleClass('closedDrawer openDrawer');
        $content.addClass('resizing').each((_, el) => {
            slideToggle(el, { ...getSlideToggleOptions(), onAnimationEnd: e => e.closest?.('.drawer-content')?.classList.remove('resizing') });
        });
    } else {
        $icon.toggleClass('openIcon closedIcon');
        $content.toggleClass('openDrawer closedDrawer');
        $content.addClass('resizing').each((_, el) => {
            slideToggle(el, { ...getSlideToggleOptions(), onAnimationEnd: e => e.closest?.('.drawer-content')?.classList.remove('resizing') });
        });
    }
}

async function initDrawer() {
    const $toggle = $('#fnvrpg_drawer .drawer-toggle');
    if (isNewNavbar()) {
        $toggle.on('click', doNavbarIconClick);
    } else {
        $('#fnvrpg_drawer_content').attr('data-slide-toggle', 'hidden').css('display', 'none');
        $toggle.on('click', openDrawerLegacy);
    }
    $toggle.on('click', clearLevelUpBadge);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function initTabs() {
    $('.fnvrpg-tab').on('click', function () {
        const tab = $(this).data('tab');
        $('.fnvrpg-tab').removeClass('active');
        $(this).addClass('active');
        $('.fnvrpg-tab-content').removeClass('active');
        $(`#fnvrpg-tab-${tab}`).addClass('active');
        renderTabContent(tab);
    });
}

function renderTabContent(tab) {
    switch (tab) {
        case 'status':     renderStatusTab();     break;
        case 'special':    renderSpecialTab();     break;
        case 'skills':     renderSkillsTab();      break;
        case 'perks':      renderPerksTab();       break;
        case 'reputation': renderReputationTab();  break;
        case 'config':     renderConfigTab();      break;
    }
}

function getActiveTab() {
    return $('.fnvrpg-tab.active').data('tab') || 'status';
}

// ── Character selector ────────────────────────────────────────────────────────

function initCharSelector() {
    // Click on card = switch active character (ignore clicks on the inject checkbox)
    $(document).on('click', '.fnvrpg-char-card', function (e) {
        if ($(e.target).is('input[type="checkbox"]') || $(e.target).closest('label.fnvrpg-inject-label').length) return;
        const which = $(this).data('char');
        if (which === activeChar) return;
        activeChar = which;
        updateCharSelector();
        renderTabContent(getActiveTab());
    });

    $('#fnvrpg-track-user').on('change', function () {
        chatData.trackUser = $(this).is(':checked');
        saveChatData();
        updateInjectBadge();
    });

    $('#fnvrpg-track-char').on('change', function () {
        chatData.trackChar = $(this).is(':checked');
        saveChatData();
        updateInjectBadge();
    });
}

function updateCharSelector() {
    // Highlight active card
    $('.fnvrpg-char-card').removeClass('active');
    $(`.fnvrpg-char-card[data-char="${activeChar}"]`).addClass('active');

    // Update name/sub displays
    const u = chatData.user, c = chatData.char;
    $('#fnvrpg-user-display-name').text(u.name || 'The Courier');
    $('#fnvrpg-user-display-sub').text(`Lv.${u.level} · ${u.karma}`);
    $('#fnvrpg-char-display-name').text(c.name || '—');
    $('#fnvrpg-char-display-sub').text(`Lv.${c.level}${c.karma !== 'Neutral' ? ` · ${c.karma}` : ''}`);

    // Sync inject checkboxes
    $('#fnvrpg-track-user').prop('checked', chatData.trackUser);
    $('#fnvrpg-track-char').prop('checked', chatData.trackChar);

    // Perk dot on tab
    const pending = pendingPerkPts(cur());
    $('#fnvrpg-perk-badge').toggle(pending > 0);
}

// ── Render: Status ────────────────────────────────────────────────────────────

function renderStatusTab() {
    const c = cur();

    $('#fnvrpg-name').val(c.name);
    $('#fnvrpg-level-val').text(c.level);
    $('#fnvrpg-karma').val(c.karma);

    const xpGap  = xpToNextLevel(c.level);
    const xpProg = c.xp - totalXpForLevel(c.level);
    $('#fnvrpg-xp-text').text(`${xpProg.toLocaleString()} / ${xpGap.toLocaleString()}`);
    $('#fnvrpg-xp-bar').css('width', (Math.min(1, xpProg / xpGap) * 100) + '%');

    const hpP = c.hp.max > 0 ? c.hp.current / c.hp.max * 100 : 0;
    $('#fnvrpg-hp-text').text(`${c.hp.current} / ${c.hp.max}`);
    $('#fnvrpg-hp-bar').css('width', Math.min(100, hpP) + '%');

    const apP = c.ap.max > 0 ? c.ap.current / c.ap.max * 100 : 0;
    $('#fnvrpg-ap-text').text(`${c.ap.current} / ${c.ap.max}`);
    $('#fnvrpg-ap-bar').css('width', Math.min(100, apP) + '%');

    $('#fnvrpg-dt').val(c.dt);
    $('#fnvrpg-caps').val(c.caps);

    // SPECIAL mini
    const miniHtml = SPECIAL_DEFS.map(d => {
        const v = c.special[d.key];
        const cls = v <= 3 ? 'sv-low' : v <= 6 ? 'sv-mid' : v <= 8 ? 'sv-high' : 'sv-max';
        return `<div class="fnvrpg-spc-cell" title="${d.name}: ${d.desc}">
            <div class="fnvrpg-spc-abbr">${d.abbr}</div>
            <div class="fnvrpg-spc-val ${cls}">${v}</div>
        </div>`;
    }).join('');
    $('#fnvrpg-special-mini').html(miniHtml);
}

// ── Render: SPECIAL ───────────────────────────────────────────────────────────

function renderSpecialTab() {
    const sp = cur().special;
    const html = SPECIAL_DEFS.map(d => {
        const v = sp[d.key];
        const numCls = v <= 3 ? 'sv-low' : v <= 6 ? 'sv-mid' : v <= 8 ? 'sv-high' : 'sv-max';
        return `<div class="fnvrpg-spc-row" title="${d.desc}">
            <div class="fnvrpg-spc-abbr-big">${d.abbr}</div>
            <div class="fnvrpg-spc-name">${d.name}</div>
            <div class="fnvrpg-spc-counter">
                <button class="fnvrpg-spc-btn" data-key="${d.key}" data-dir="-1">−</button>
                <div class="fnvrpg-spc-numval ${numCls}" id="fnvrpg-sv-${d.key}">${v}</div>
                <button class="fnvrpg-spc-btn" data-key="${d.key}" data-dir="1">+</button>
            </div>
        </div>`;
    }).join('');
    $('#fnvrpg-special-list').html(html);

    $('#fnvrpg-special-list').off('click', '.fnvrpg-spc-btn').on('click', '.fnvrpg-spc-btn', function () {
        const key = $(this).data('key');
        const dir = Number($(this).data('dir'));
        const nxt = Math.max(1, Math.min(10, cur().special[key] + dir));
        if (nxt === cur().special[key]) return;
        cur().special[key] = nxt;
        syncDerived(cur());
        saveChatData();
        renderSpecialTab();
        renderStatusTab();
        renderDerivedStats();
        updateCharSelector();
        if ($('#fnvrpg-tab-skills').hasClass('active')) renderSkillsTab();
    });

    renderDerivedStats();
}

function renderDerivedStats() {
    const c = cur(), sp = c.special;
    const bonuses = getPerkBonuses(c);
    const items = [
        { label: 'Max HP',       value: calcMaxHP(sp, c.level) + bonuses.maxHp },
        { label: 'Max AP',       value: calcMaxAP(sp) },
        { label: 'Carry Weight', value: (calcCarryWt(sp) + bonuses.carryWt) + ' lbs' },
        { label: 'Crit Chance',  value: (parseFloat(calcCritPct(sp)) + bonuses.critPct).toFixed(1) + '%' },
        { label: 'Melee Bonus',  value: '+' + calcMeleeDmg(sp) },
        { label: 'Skill Rate',   value: (calcSkillRate(sp) + bonuses.skillRate) + '/lvl' },
        { label: 'Poison Res.',  value: sp.end * 5 + '%' },
        { label: 'Rad Res.',     value: sp.end * 2 + '%' },
        ...(bonuses.dt > 0     ? [{ label: 'Perk DT',   value: '+' + bonuses.dt }] : []),
        ...(bonuses.xpMult > 0 ? [{ label: 'XP Bonus',  value: '+' + bonuses.xpMult + '%' }] : []),
    ];
    $('#fnvrpg-derived').html(
        items.map(i => `<div class="fnvrpg-derived-item">
            <div class="fnvrpg-derived-lbl">${i.label}</div>
            <div class="fnvrpg-derived-val">${i.value}</div>
        </div>`).join('')
    );
}

// ── Render: Skills ────────────────────────────────────────────────────────────

function skillFloor(def, c) {
    return calcSkillBase(def, c.special) + (c.tagSkills.includes(def.key) ? 15 : 0);
}

function renderSkillsTab() {
    const c   = cur();
    const pts = c.skillPoints || 0;

    // Normalize any sub-floor values (handles old saves / SPECIAL changes)
    let normalized = false;
    for (const d of SKILL_DEFS) {
        const fl = skillFloor(d, c);
        if ((c.skills[d.key] ?? 0) < fl) { c.skills[d.key] = fl; normalized = true; }
    }
    if (normalized) saveChatData();

    // Skill points banner
    $('#fnvrpg-skill-pts-num').text(`${pts} available`);
    $('#fnvrpg-skill-pts-notice').toggle(pts > 0);
    $('#fnvrpg-skill-pts-count').text(pts);

    const html = SKILL_DEFS.map(d => {
        const base   = calcSkillBase(d, c.special);
        const tagged = c.tagSkills.includes(d.key);
        const floor  = base + (tagged ? 15 : 0);
        const total  = c.skills[d.key] ?? floor;

        let valCls = '';
        if (total >= 100) valCls = 'sk-max';
        else if (total >= 75) valCls = 'sk-high';
        else if (tagged)      valCls = 'sk-tag';

        const canInc = total < 100 && pts > 0;
        const canDec = total > floor;

        return `<div class="fnvrpg-skill-row">
            <button class="fnvrpg-skill-tag-btn ${tagged ? 'tagged' : ''}" data-key="${d.key}"
                    title="${tagged ? 'Untag' : 'Tag'} skill">${tagged ? '★' : '☆'}</button>
            <div class="fnvrpg-skill-name">${d.name}</div>
            <div class="fnvrpg-skill-stat">${d.stat.toUpperCase()}</div>
            <div class="fnvrpg-skill-base" title="SPECIAL base">${base}</div>
            <div class="fnvrpg-skill-arrow">→</div>
            <div class="fnvrpg-skill-stepper">
                <button class="fnvrpg-skill-pt-btn" data-key="${d.key}" data-dir="-1"
                        ${!canDec ? 'disabled' : ''}>−</button>
                <div class="fnvrpg-skill-val ${valCls}" data-key="${d.key}">${total}</div>
                <button class="fnvrpg-skill-pt-btn" data-key="${d.key}" data-dir="1"
                        ${!canInc ? 'disabled' : ''}>+</button>
            </div>
        </div>`;
    }).join('');
    $('#fnvrpg-skills-list').html(html);

    // Tag toggle
    $('#fnvrpg-skills-list').off('click.tag', '.fnvrpg-skill-tag-btn').on('click.tag', '.fnvrpg-skill-tag-btn', function (e) {
        e.stopPropagation();
        const key = $(this).data('key');
        const c   = cur();
        const def = SKILL_DEFS.find(d => d.key === key);
        if (c.tagSkills.includes(key)) {
            c.tagSkills = c.tagSkills.filter(k => k !== key);
            c.skills[key] = Math.max(calcSkillBase(def, c.special), (c.skills[key] ?? 0) - 15);
        } else {
            if (c.tagSkills.length >= 3) { showToast('Maximum 3 tagged skills.', 'warning'); return; }
            c.tagSkills.push(key);
            c.skills[key] = Math.min(100, (c.skills[key] ?? 0) + 15);
        }
        saveChatData();
        renderSkillsTab();
    });

    // ± buttons (spend / refund skill points)
    $('#fnvrpg-skills-list').off('click.pts', '.fnvrpg-skill-pt-btn').on('click.pts', '.fnvrpg-skill-pt-btn', function () {
        if ($(this).is(':disabled')) return;
        const key = $(this).data('key');
        const dir = Number($(this).data('dir'));
        const c   = cur();
        const def = SKILL_DEFS.find(d => d.key === key);
        const fl  = skillFloor(def, c);
        const val = c.skills[key] ?? fl;

        if (dir > 0) {
            if ((c.skillPoints || 0) <= 0) { showToast('No skill points — level up to earn more.', 'warning'); return; }
            if (val >= 100) return;
            c.skills[key]   = val + 1;
            c.skillPoints   = (c.skillPoints || 0) - 1;
        } else {
            if (val <= fl) return;
            c.skills[key]   = val - 1;
            c.skillPoints   = (c.skillPoints || 0) + 1;
        }
        saveChatData();
        renderSkillsTab();
    });
}

// ── Render: Perks ─────────────────────────────────────────────────────────────

function checkPerkReqs(perk, char) {
    const missing = [];
    if (char.level < perk.minLv) missing.push(`Level ${perk.minLv}`);
    if (!perk.req) return { ok: missing.length === 0, missing };

    const SPECIAL_MAP = { STR: 'str', PER: 'per', END: 'end', CHR: 'chr', INT: 'int', AGI: 'agi', LUK: 'luk' };
    const SKILL_MAP = {
        'Barter': 'barter', 'Energy Weapons': 'energyWeapons', 'Explosives': 'explosives',
        'Guns': 'guns', 'Lockpick': 'lockpick', 'Medicine': 'medicine',
        'Melee Weapons': 'meleeWeapons', 'Repair': 'repair', 'Science': 'science',
        'Sneak': 'sneak', 'Speech': 'speech', 'Survival': 'survival', 'Unarmed': 'unarmed',
    };

    for (const part of perk.req.split(',').map(s => s.trim())) {
        const m = part.match(/^([A-Za-z ]+?)\s+(\d+)$/);
        if (!m) continue;
        const label = m[1].trim(), val = parseInt(m[2]);
        if (SPECIAL_MAP[label]) {
            if ((char.special[SPECIAL_MAP[label]] || 0) < val) missing.push(part);
        } else if (SKILL_MAP[label]) {
            if ((char.skills[SKILL_MAP[label]] || 0) < val) missing.push(part);
        }
    }
    return { ok: missing.length === 0, missing };
}

function applyPerkSkillEffects(char, perkName, remove = false) {
    const fx = PERK_EFFECTS[perkName];
    if (!fx?.skills) return;
    for (const [sk, delta] of Object.entries(fx.skills)) {
        const sign = remove ? -1 : 1;
        const def = SKILL_DEFS.find(d => d.key === sk);
        if (!def) continue;
        const fl = skillFloor(def, char);
        char.skills[sk] = Math.max(fl, Math.min(100, (char.skills[sk] ?? fl) + sign * delta));
    }
}

function renderPerksTab() {
    const c       = cur();
    const total   = availablePerkPts(c.level);
    const pending = pendingPerkPts(c);
    const used    = c.perks.length;

    // Perk points bar
    $('#fnvrpg-perk-pts-text').text(`${used} / ${total} used`);
    $('#fnvrpg-perk-pending-count').text(pending);
    $('#fnvrpg-perk-available-notice').toggle(pending > 0);
    $('#fnvrpg-perk-badge').toggle(pending > 0);

    // Active perks list
    if (c.perks.length === 0) {
        $('#fnvrpg-perks-list').html('');
        $('#fnvrpg-perks-empty').show();
    } else {
        $('#fnvrpg-perks-empty').hide();
        $('#fnvrpg-perks-list').html(
            c.perks.map((p, i) => {
                const catalogEntry = PERK_CATALOG.find(pc => pc.name === p);
                const desc = catalogEntry?.desc || c.perkDescs?.[p] || '';
                return `<div class="fnvrpg-perk-item">
                    <div class="fnvrpg-perk-info">
                        <span class="fnvrpg-perk-name"><i class="fa-solid fa-star-of-life"></i>${escHtml(p)}</span>
                        ${desc ? `<div class="fnvrpg-perk-desc-small">${escHtml(desc)}</div>` : ''}
                    </div>
                    <button class="fnvrpg-perk-del" data-idx="${i}" title="Remove perk">✕</button>
                </div>`;
            }).join('')
        );
    }

    $('#fnvrpg-perks-list').off('click', '.fnvrpg-perk-del').on('click', '.fnvrpg-perk-del', function () {
        const idx = Number($(this).data('idx'));
        const perkName = cur().perks[idx];
        cur().perks.splice(idx, 1);
        if (cur().perkDescs) delete cur().perkDescs[perkName];
        applyPerkSkillEffects(cur(), perkName, true);
        syncDerived(cur());
        saveChatData();
        renderPerksTab();
        if (getActiveTab() === 'skills') renderSkillsTab();
        refreshMsgPanels();
    });

    // Render catalog if open
    if (catalogOpen) renderPerkCatalog($('#fnvrpg-perk-search').val() || '');
}

function renderPerkCatalog(filter) {
    const c = cur();
    const q = filter.toLowerCase();
    const searching = q.length > 0;

    // Group by category
    const cats = {};
    for (const p of PERK_CATALOG) {
        if (q && !p.name.toLowerCase().includes(q) && !p.desc.toLowerCase().includes(q)) continue;
        if (!cats[p.cat]) cats[p.cat] = [];
        cats[p.cat].push(p);
    }

    let html = '';
    for (const [cat, perks] of Object.entries(cats)) {
        const isOpen = searching || expandedPerkCats.has(cat);
        const arrow = isOpen ? '▼' : '▶';
        let itemsHtml = '';
        for (const p of perks) {
            const taken = c.perks.includes(p.name);
            const reqs  = checkPerkReqs(p, c);
            const reqCls = !taken && !reqs.ok ? 'reqs-unmet' : '';
            itemsHtml += `<div class="fnvrpg-perk-catalog-item ${taken ? 'already-taken' : ''} ${reqCls}" data-perk="${escHtml(p.name)}">
                <div class="fnvrpg-perk-catalog-info">
                    <div class="fnvrpg-perk-catalog-name">${escHtml(p.name)}
                        <span style="font-size:10px;font-weight:normal;color:var(--fnv-text-muted);margin-left:5px;">Lv.${p.minLv}</span>
                    </div>
                    <div class="fnvrpg-perk-catalog-desc">${escHtml(p.desc)}</div>
                </div>
                ${p.req ? `<div class="fnvrpg-perk-catalog-req ${reqs.ok ? 'req-ok' : 'req-fail'}">${reqs.ok ? '✓ ' : '✗ '}${escHtml(p.req)}</div>` : ''}
                ${!taken ? `<button class="fnvrpg-perk-add-btn" data-perk="${escHtml(p.name)}" title="Add perk">+</button>` : ''}
            </div>`;
        }
        html += `<div class="fnvrpg-perk-cat-header" data-cat="${escHtml(cat)}">
            <span class="fnvrpg-perk-cat-arrow">${arrow}</span>
            ${escHtml(cat)}
            <span class="fnvrpg-perk-cat-count">${perks.length}</span>
        </div>
        <div class="fnvrpg-perk-cat-body" data-cat="${escHtml(cat)}" style="display:${isOpen ? 'block' : 'none'}">
            ${itemsHtml}
        </div>`;
    }

    if (!html) html = '<div class="fnvrpg-empty-hint">No perks match your search.</div>';
    $('#fnvrpg-perk-catalog').html(html);

    $('#fnvrpg-perk-catalog').off('click', '.fnvrpg-perk-cat-header').on('click', '.fnvrpg-perk-cat-header', function () {
        const cat = $(this).data('cat');
        const $body = $(this).next('.fnvrpg-perk-cat-body');
        if (expandedPerkCats.has(cat)) {
            expandedPerkCats.delete(cat);
            $body.slideUp(150);
            $(this).find('.fnvrpg-perk-cat-arrow').text('▶');
        } else {
            expandedPerkCats.add(cat);
            $body.slideDown(150);
            $(this).find('.fnvrpg-perk-cat-arrow').text('▼');
        }
    });

    $('#fnvrpg-perk-catalog').off('click', '.fnvrpg-perk-add-btn').on('click', '.fnvrpg-perk-add-btn', function (e) {
        e.stopPropagation();
        addPerk($(this).data('perk'));
    });
}

function addPerk(name, customDesc = '') {
    const c = cur();
    if (!name) return;
    if (c.perks.includes(name)) { showToast('Already have this perk.', 'info'); return; }

    const catalogEntry = PERK_CATALOG.find(p => p.name === name);
    if (catalogEntry) {
        const { ok, missing } = checkPerkReqs(catalogEntry, c);
        if (!ok) {
            if (!confirm(`Requirements not met: ${missing.join(', ')}\n\nAdd "${name}" anyway?`)) return;
        }
    }

    const pending = pendingPerkPts(c);
    if (pending <= 0) {
        if (!confirm(`No perk points available (level up to earn more). Add "${name}" anyway?`)) return;
    }

    c.perks.push(name);
    if (customDesc) {
        c.perkDescs = c.perkDescs || {};
        c.perkDescs[name] = customDesc;
    }
    applyPerkSkillEffects(c, name);
    syncDerived(c);
    saveChatData();
    renderPerksTab();
    if (getActiveTab() === 'skills') renderSkillsTab();
    refreshMsgPanels();
}

// ── Render: Reputation ────────────────────────────────────────────────────────

function renderReputationTab() {
    const rep     = cur().reputation;
    const entries = Object.entries(rep);

    if (entries.length === 0) {
        $('#fnvrpg-rep-list').html('');
        $('#fnvrpg-rep-empty').show();
        return;
    }
    $('#fnvrpg-rep-empty').hide();

    const html = entries.map(([faction, level]) => {
        const safeLevel = REP_LEVELS.includes(level) ? level : 'Neutral';
        const idx       = REP_LEVELS.indexOf(safeLevel);
        return `<div class="fnvrpg-rep-row">
            <div class="fnvrpg-rep-faction" title="${escHtml(faction)}">${escHtml(faction)}</div>
            <div class="fnvrpg-rep-cycler">
                <button class="fnvrpg-rep-cycle-btn" data-faction="${escHtml(faction)}" data-dir="-1"
                        ${idx <= 0 ? 'disabled' : ''}>◀</button>
                <div class="fnvrpg-rep-level r-${safeLevel.toLowerCase()}">${safeLevel}</div>
                <button class="fnvrpg-rep-cycle-btn" data-faction="${escHtml(faction)}" data-dir="1"
                        ${idx >= REP_LEVELS.length - 1 ? 'disabled' : ''}>▶</button>
            </div>
            <button class="fnvrpg-rep-del" data-faction="${escHtml(faction)}" title="Remove">✕</button>
        </div>`;
    }).join('');
    $('#fnvrpg-rep-list').html(html);

    $('#fnvrpg-rep-list').off('click', '.fnvrpg-rep-cycle-btn').on('click', '.fnvrpg-rep-cycle-btn', function () {
        if ($(this).is(':disabled')) return;
        const fac  = $(this).data('faction');
        const dir  = Number($(this).data('dir'));
        const cur_level = cur().reputation[fac] || 'Neutral';
        const idx  = REP_LEVELS.indexOf(cur_level);
        const next = REP_LEVELS[Math.max(0, Math.min(REP_LEVELS.length - 1, idx + dir))];
        cur().reputation[fac] = next;
        saveChatData();
        renderReputationTab();
    });

    $('#fnvrpg-rep-list').off('click', '.fnvrpg-rep-del').on('click', '.fnvrpg-rep-del', function () {
        delete cur().reputation[$(this).data('faction')];
        saveChatData();
        renderReputationTab();
    });
}

// ── Render: Config ────────────────────────────────────────────────────────────

function renderConfigTab() {
    $('#fnvrpg-cfg-enabled').prop('checked', settings.enabled);
    $('#fnvrpg-cfg-inject').prop('checked', settings.injectContext);
    $('#fnvrpg-cfg-position').val(settings.injectionPosition);
    $('#fnvrpg-cfg-perk-descs').prop('checked', settings.injectPerkDescs ?? false);
    $('#fnvrpg-notes').val(cur().notes || '');
    $('.fnvrpg-xp-rate-btn').removeClass('active');
    $(`.fnvrpg-xp-rate-btn[data-rate="${settings.xpRate || 'medium'}"]`).addClass('active');
}

// ── Full UI refresh ───────────────────────────────────────────────────────────

function refreshUI() {
    updateCharSelector();
    updateInjectBadge();
    renderTabContent(getActiveTab());
    refreshMsgPanels();
}

function updateInjectBadge() {
    const on = settings.enabled && settings.injectContext;
    $('#fnvrpg-inject-badge')
        .text(settings.enabled ? (on ? '● ACTIVE' : '○ PAUSED') : '○ DISABLED')
        .attr('class', `fnvrpg-badge ${on ? 'fnvrpg-badge-on' : 'fnvrpg-badge-off'}`);
}

function showLevelUpBadge() {
    $('#fnvrpg-level-badge').addClass('active');
}

function clearLevelUpBadge() {
    $('#fnvrpg-level-badge').removeClass('active');
}

// ── Event wiring ──────────────────────────────────────────────────────────────

function initStatusEvents() {
    $('#fnvrpg-name').on('change', function () {
        cur().name = $(this).val().trim() || (activeChar === 'user' ? 'The Courier' : '');
        saveChatData();
        updateCharSelector();
    });

    // Level
    $('#fnvrpg-level-dec').on('click', () => {
        if (cur().level <= 1) return;
        cur().level--;
        cur().xp = totalXpForLevel(cur().level);
        syncDerived(cur()); saveChatData(); renderStatusTab(); renderDerivedStats(); updateCharSelector();
    });
    $('#fnvrpg-level-inc').on('click', () => {
        if (cur().level >= 30) return;
        cur().level++;
        cur().xp = totalXpForLevel(cur().level);
        syncDerived(cur()); saveChatData(); renderStatusTab(); renderDerivedStats(); updateCharSelector();
    });

    $('#fnvrpg-karma').on('change', function () {
        cur().karma = $(this).val(); saveChatData(); updateCharSelector();
    });

    // XP
    $('#fnvrpg-xp-add').on('click', () => {
        const amt = parseInt($('#fnvrpg-xp-amount').val()) || 0;
        if (amt <= 0) return;
        const xpBonuses = getPerkBonuses(cur());
        const effective = Math.round(amt * (1 + xpBonuses.xpMult / 100));
        cur().xp += effective;
        while (cur().level < 30 && cur().xp >= totalXpForLevel(cur().level + 1)) {
            cur().level++;
            syncDerived(cur());
            const lvBonuses = getPerkBonuses(cur());
            const skPts = calcSkillRate(cur().special) + lvBonuses.skillRate;
            cur().skillPoints = (cur().skillPoints || 0) + skPts;
            showToast(`Level up! Now Level ${cur().level}. +${skPts} skill points. ${pendingPerkPts(cur())} perk point(s) available.`, 'success');
            showLevelUpBadge();
        }
        saveChatData(); renderStatusTab(); updateCharSelector();
        if (getActiveTab() === 'perks') renderPerksTab();
    });
    $('#fnvrpg-xp-set').on('click', () => {
        const val = parseInt($('#fnvrpg-xp-amount').val()) || 0;
        cur().xp = Math.max(0, val);
        cur().level = levelFromXp(cur().xp);
        syncDerived(cur()); saveChatData(); renderStatusTab(); renderDerivedStats(); updateCharSelector();
    });

    // HP
    $('#fnvrpg-hp-dmg').on('click', () => {
        const d = parseInt($('#fnvrpg-hp-delta').val()) || 0;
        cur().hp.current = Math.max(0, cur().hp.current - d);
        saveChatData(); renderStatusTab();
    });
    $('#fnvrpg-hp-heal').on('click', () => {
        const d = parseInt($('#fnvrpg-hp-delta').val()) || 0;
        cur().hp.current = Math.min(cur().hp.max, cur().hp.current + d);
        saveChatData(); renderStatusTab();
    });
    $('#fnvrpg-hp-full').on('click', () => { cur().hp.current = cur().hp.max; saveChatData(); renderStatusTab(); });

    // AP
    $('#fnvrpg-ap-use').on('click', () => {
        const d = parseInt($('#fnvrpg-ap-delta').val()) || 0;
        cur().ap.current = Math.max(0, cur().ap.current - d);
        saveChatData(); renderStatusTab();
    });
    $('#fnvrpg-ap-restore').on('click', () => {
        const d = parseInt($('#fnvrpg-ap-delta').val()) || 0;
        cur().ap.current = Math.min(cur().ap.max, cur().ap.current + d);
        saveChatData(); renderStatusTab();
    });
    $('#fnvrpg-ap-full').on('click', () => { cur().ap.current = cur().ap.max; saveChatData(); renderStatusTab(); });

    // DT
    $('#fnvrpg-dt-dec').on('click', () => { cur().dt = Math.max(0, cur().dt - 1); saveChatData(); $('#fnvrpg-dt').val(cur().dt); });
    $('#fnvrpg-dt-inc').on('click', () => { cur().dt = Math.min(99, cur().dt + 1); saveChatData(); $('#fnvrpg-dt').val(cur().dt); });
    $('#fnvrpg-dt').on('change', function () {
        cur().dt = Math.max(0, Math.min(99, parseInt($(this).val()) || 0));
        $(this).val(cur().dt); saveChatData();
    });

    // Caps
    $('#fnvrpg-caps-sub').on('click', () => {
        const d = parseInt($('#fnvrpg-caps-delta').val()) || 100;
        cur().caps = Math.max(0, cur().caps - d); saveChatData(); $('#fnvrpg-caps').val(cur().caps);
    });
    $('#fnvrpg-caps-add').on('click', () => {
        const d = parseInt($('#fnvrpg-caps-delta').val()) || 100;
        cur().caps += d; saveChatData(); $('#fnvrpg-caps').val(cur().caps);
    });
    $('#fnvrpg-caps').on('change', function () {
        cur().caps = Math.max(0, parseInt($(this).val()) || 0); $(this).val(cur().caps); saveChatData();
    });
}

function initPerksEvents() {
    // Catalog toggle
    $('#fnvrpg-catalog-toggle').on('click', function () {
        catalogOpen = !catalogOpen;
        $('#fnvrpg-perk-catalog-wrap').toggle(catalogOpen);
        $(this).find('i').toggleClass('fa-book-open fa-book');
        if (catalogOpen) renderPerkCatalog('');
    });

    // Search
    $('#fnvrpg-perk-search').on('input', function () {
        renderPerkCatalog($(this).val());
    });

    // Custom perk
    const doAddCustom = () => {
        const name = $('#fnvrpg-perk-custom-input').val().trim();
        if (!name) return;
        const desc = $('#fnvrpg-perk-custom-desc').val().trim();
        addPerk(name, desc);
        $('#fnvrpg-perk-custom-input').val('');
        $('#fnvrpg-perk-custom-desc').val('');
    };
    $('#fnvrpg-perk-custom-add').on('click', doAddCustom);
    $('#fnvrpg-perk-custom-input').on('keydown', (e) => { if (e.key === 'Enter') doAddCustom(); });
    $('#fnvrpg-perk-custom-desc').on('keydown', (e) => { if (e.key === 'Enter') doAddCustom(); });

    // Populate datalist
    $('#fnvrpg-perk-datalist').html(PERK_CATALOG.map(p => `<option value="${escHtml(p.name)}">`).join(''));
}

function initSkillsEvents() {
    $('#fnvrpg-skpts-add').on('click', () => {
        const amt = parseInt($('#fnvrpg-skpts-amount').val()) || 0;
        if (amt <= 0) return;
        cur().skillPoints = (cur().skillPoints || 0) + amt;
        saveChatData(); renderSkillsTab();
    });
    $('#fnvrpg-skpts-set').on('click', () => {
        const val = parseInt($('#fnvrpg-skpts-amount').val());
        if (isNaN(val) || val < 0) return;
        cur().skillPoints = val;
        saveChatData(); renderSkillsTab();
    });
}

function initRepEvents() {
    const doAdd = () => {
        const name = $('#fnvrpg-rep-faction-input').val().trim();
        if (!name) return;
        if (cur().reputation[name] !== undefined) { showToast('Faction already exists.', 'info'); return; }
        cur().reputation[name] = 'Neutral';
        $('#fnvrpg-rep-faction-input').val('');
        saveChatData(); renderReputationTab();
    };
    $('#fnvrpg-rep-add').on('click', doAdd);
    $('#fnvrpg-rep-faction-input').on('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
}

function initConfigEvents() {
    $('#fnvrpg-cfg-enabled').on('change', function () {
        settings.enabled = $(this).is(':checked'); saveSettings(); updateInjectBadge();
    });
    $('#fnvrpg-cfg-inject').on('change', function () {
        settings.injectContext = $(this).is(':checked'); saveSettings(); updateInjectBadge();
    });
    $('#fnvrpg-cfg-perk-descs').on('change', function () {
        settings.injectPerkDescs = $(this).is(':checked'); saveSettings();
    });
    $('#fnvrpg-cfg-position').on('change', function () {
        settings.injectionPosition = Math.max(0, Math.min(30, parseInt($(this).val()) || 1));
        $(this).val(settings.injectionPosition); saveSettings();
    });

    // XP rate
    $(document).on('click', '.fnvrpg-xp-rate-btn', function () {
        settings.xpRate = $(this).data('rate');
        saveSettings();
        renderConfigTab();
    });

    // Quick position presets
    $(document).on('click', '.fnvrpg-pos-btn', function () {
        const pos = Number($(this).data('pos'));
        settings.injectionPosition = pos;
        $('#fnvrpg-cfg-position').val(pos);
        saveSettings();
    });

    $('#fnvrpg-notes').on('change', function () {
        cur().notes = $(this).val(); saveChatData();
    });

    // Export / Import / Reset
    $('#fnvrpg-export').on('click', () => {
        const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
        const a = Object.assign(document.createElement('a'), {
            href: URL.createObjectURL(blob),
            download: `fnv_rpg_${Date.now()}.json`,
        });
        a.click(); URL.revokeObjectURL(a.href);
    });

    $('#fnvrpg-import').on('click', () => {
        const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json' });
        input.onchange = (e) => {
            const file = e.target.files[0]; if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    if (!data.user && !data.char) { showToast('Invalid character file.', 'error'); return; }
                    chatData = {
                        user: deepMergeChar(data.user || {}, createDefaultChar('The Courier')),
                        char: deepMergeChar(data.char || {}, createDefaultChar('')),
                        trackUser: data.trackUser !== false,
                        trackChar: data.trackChar !== false,
                    };
                    saveChatData(); refreshUI();
                    showToast('Character data imported.', 'success');
                } catch (_) { showToast('Failed to parse file.', 'error'); }
            };
            reader.readAsText(file);
        };
        input.click();
    });

    $('#fnvrpg-reset').on('click', () => {
        if (!confirm(`Reset ${activeChar === 'user' ? 'player' : 'character'} to defaults?`)) return;
        chatData[activeChar] = createDefaultChar(activeChar === 'user' ? 'The Courier' : '');
        saveChatData(); refreshUI();
        showToast('Character reset.', 'info');
    });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function showToast(msg, type = 'info') {
    window.toastr ? toastr[type](msg, 'FNV-RPG') : console.log(`[FNV-RPG] ${type}: ${msg}`);
}

function escHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Extension settings panel entry (in Extensions sidebar) ───────────────────

function injectExtSettingsEntry() {
    const html = `
    <div id="fnvrpg-ext-settings" class="inline-drawer" style="margin-top:4px;">
        <div class="inline-drawer-toggle inline-drawer-header">
            <b>Fallout RPG</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label class="checkbox_label" style="margin:5px 0;">
                <input type="checkbox" id="fnvrpg-ext-enabled">
                <span>Extension enabled</span>
            </label>
            <label class="checkbox_label" style="margin:5px 0;">
                <input type="checkbox" id="fnvrpg-ext-inject">
                <span>Inject character sheet into AI context</span>
            </label>
            <p style="font-size:11px;color:#888;margin:4px 0;">
                Open <i class="fa-solid fa-vault"></i> in the top bar to manage character stats.
            </p>
        </div>
    </div>`;
    $('#extensions_settings2').append(html);

    $('#fnvrpg-ext-enabled').prop('checked', settings.enabled).on('change', function () {
        settings.enabled = $(this).is(':checked');
        saveSettings(); updateInjectBadge();
        $('#fnvrpg-cfg-enabled').prop('checked', settings.enabled);
    });
    $('#fnvrpg-ext-inject').prop('checked', settings.injectContext).on('change', function () {
        settings.injectContext = $(this).is(':checked');
        saveSettings(); updateInjectBadge();
        $('#fnvrpg-cfg-inject').prop('checked', settings.injectContext);
    });
}

// ── Entry point ───────────────────────────────────────────────────────────────

(async function () {
    console.log(`[FNV-RPG] Loading v${VERSION}...`);

    loadSettings();
    ensureRegexRule();
    ensureStatRegexRule();
    await initNavbar();

    // Inject drawer into top nav (same pattern as Horae)
    const drawerHtml = await renderExtensionTemplateAsync(TMPL_PATH, 'drawer');
    $('#extensions-settings-button').after(drawerHtml);

    injectExtSettingsEntry();
    await initDrawer();
    initTabs();
    initCharSelector();

    loadChatData();
    // Try to auto-populate char name from current context
    try {
        const ctx = getContext();
        if (ctx?.name2 && !chatData.char.name) chatData.char.name = ctx.name2;
    } catch (_) {}
    syncDerived(chatData.user);
    syncDerived(chatData.char);

    initStatusEvents();
    initSkillsEvents();
    initPerksEvents();
    initRepEvents();
    initConfigEvents();

    refreshUI();

    eventSource.on(event_types.CHAT_COMPLETION_PROMPT_READY, onPromptReady);
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    if (event_types.CHARACTER_SELECTED) eventSource.on(event_types.CHARACTER_SELECTED, onChatChanged);
    if (event_types.CHARACTER_MESSAGE_RENDERED) eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, onMessageReceived);
    if (event_types.MESSAGE_DELETED) eventSource.on(event_types.MESSAGE_DELETED, onStructureChanged);
    if (event_types.MESSAGE_SWIPED) eventSource.on(event_types.MESSAGE_SWIPED, onStructureChanged);
    if (event_types.CHARACTER_MESSAGE_SWIPED) eventSource.on(event_types.CHARACTER_MESSAGE_SWIPED, onStructureChanged);

    console.log(`[FNV-RPG] v${VERSION} ready. Good luck out there, Courier.`);
})();
