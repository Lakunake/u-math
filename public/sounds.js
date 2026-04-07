// U-MAt sounds.js — synthesized Web Audio engine (no audio files)
const SFX = (() => {
    let ctx = null;
    let masterGain = null;
    let enabled = true;

    function getCtx() {
        if (!ctx) {
            ctx = new (window.AudioContext || window.webkitAudioContext)();
            masterGain = ctx.createGain();
            masterGain.gain.value = 0.6;
            masterGain.connect(ctx.destination);
        }
        // Resume if browser suspended it (requires user gesture policy)
        if (ctx.state === 'suspended') ctx.resume();
        return ctx;
    }

    function osc(freq, type, startTime, duration, peakGain = 0.4, endGain = 0.001) {
        const c = getCtx();
        const o = c.createOscillator();
        const g = c.createGain();
        o.connect(g); g.connect(masterGain);
        o.type = type;
        o.frequency.setValueAtTime(freq, startTime);
        g.gain.setValueAtTime(peakGain, startTime);
        g.gain.exponentialRampToValueAtTime(endGain, startTime + duration);
        o.start(startTime); o.stop(startTime + duration);
    }

    function freqSweep(startFreq, endFreq, type, startTime, duration, peakGain = 0.3) {
        const c = getCtx();
        const o = c.createOscillator();
        const g = c.createGain();
        o.connect(g); g.connect(masterGain);
        o.type = type;
        o.frequency.setValueAtTime(startFreq, startTime);
        o.frequency.exponentialRampToValueAtTime(endFreq, startTime + duration);
        g.gain.setValueAtTime(peakGain, startTime);
        g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        o.start(startTime); o.stop(startTime + duration);
    }

    function noise(startTime, duration, gain = 0.15, filterFreq = 2000) {
        const c = getCtx();
        const buf = c.createBuffer(1, c.sampleRate * duration, c.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        const src = c.createBufferSource();
        src.buffer = buf;
        const filt = c.createBiquadFilter();
        filt.type = 'bandpass';
        filt.frequency.value = filterFreq;
        filt.Q.value = 0.8;
        const g = c.createGain();
        src.connect(filt); filt.connect(g); g.connect(masterGain);
        g.gain.setValueAtTime(gain, startTime);
        g.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
        src.start(startTime); src.stop(startTime + duration);
    }

    const sounds = {
        // Card play swish — descending freq sweep + noise burst
        cardPlay() {
            if (!enabled) return;
            const c = getCtx(), t = c.currentTime;
            freqSweep(900, 300, 'sine', t, 0.18, 0.25);
            noise(t, 0.12, 0.12, 1800);
        },

        // Correct answer — two-note ascending ding
        correct() {
            if (!enabled) return;
            const c = getCtx(), t = c.currentTime;
            osc(523.25, 'sine', t, 0.15, 0.35);           // C5
            osc(783.99, 'sine', t + 0.12, 0.4, 0.45);     // G5
            osc(1046.5, 'sine', t + 0.24, 0.5, 0.3);      // C6
        },

        // Wrong answer — descending buzz with low thud
        wrong() {
            if (!enabled) return;
            const c = getCtx(), t = c.currentTime;
            freqSweep(300, 80, 'sawtooth', t, 0.35, 0.3);
            osc(60, 'sine', t, 0.25, 0.5);                 // thud
        },

        // Timer tick — short click
        tick(urgent = false) {
            if (!enabled) return;
            const c = getCtx(), t = c.currentTime;
            const freq = urgent ? 1200 : 800;
            osc(freq, 'square', t, 0.03, urgent ? 0.12 : 0.06);
        },

        // Your turn — ascending notification chime
        yourTurn() {
            if (!enabled) return;
            const c = getCtx(), t = c.currentTime;
            osc(440, 'sine', t, 0.12, 0.2);
            osc(554.37, 'sine', t + 0.1, 0.12, 0.2);
            osc(659.25, 'sine', t + 0.2, 0.25, 0.3);
        },

        // Extra turn (2-player skip/reverse) — double chime
        extraTurn() {
            if (!enabled) return;
            const c = getCtx(), t = c.currentTime;
            osc(659.25, 'sine', t, 0.12, 0.25);
            osc(659.25, 'sine', t + 0.18, 0.2, 0.25);
        },

        // Joker played — wild magic shimmer
        joker() {
            if (!enabled) return;
            const c = getCtx(), t = c.currentTime;
            [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => {
                osc(f, 'sine', t + i * 0.06, 0.3, 0.2);
            });
        },

        // Damage taken — impact thud
        damage() {
            if (!enabled) return;
            const c = getCtx(), t = c.currentTime;
            freqSweep(200, 40, 'sawtooth', t, 0.3, 0.4);
            noise(t, 0.08, 0.2, 500);
        },

        // Draw card — whoosh upward
        draw() {
            if (!enabled) return;
            const c = getCtx(), t = c.currentTime;
            freqSweep(200, 600, 'sine', t, 0.2, 0.2);
            noise(t, 0.15, 0.08, 3000);
        },

        // Player eliminated — sad descending
        eliminated() {
            if (!enabled) return;
            const c = getCtx(), t = c.currentTime;
            osc(392, 'sine', t, 0.2, 0.3);
            osc(349.23, 'sine', t + 0.15, 0.25, 0.3);
            osc(293.66, 'sine', t + 0.35, 0.45, 0.35);
        },

        // Game over winner — fanfare
        gameOver() {
            if (!enabled) return;
            const c = getCtx(), t = c.currentTime;
            [523.25, 523.25, 783.99, 1046.5].forEach((f, i) => {
                osc(f, 'sine', t + i * 0.18, 0.4, 0.4);
            });
            osc(1318.5, 'sine', t + 0.72, 0.8, 0.5);
        },

        // Pool reset (new deck) — shuffle rustle
        poolReset() {
            if (!enabled) return;
            const c = getCtx(), t = c.currentTime;
            for (let i = 0; i < 4; i++) {
                noise(t + i * 0.06, 0.08, 0.1, 800 + i * 200);
            }
        },

        setEnabled(val) { enabled = val; },
        isEnabled() { return enabled; }
    };

    return sounds;
})();
