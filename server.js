/* ============================================================
   РОЗРАХУНОК НАГОРОД ПІД ЧАС ГРИ
   ------------------------------------------------------------
   Монети строго обмежені: 1 монета за правильну відповідь,
   +1 якщо відповів дуже швидко. Стеля за гру — ECONOMY.coinsPerGameCap (30).
   Бали (score) рахуються окремо для рейтингу.
   ============================================================ */
function calculateRewards(opts) {
    const {
        elapsed,
        timePerQuestion,
        mode,
        streak,
        powerActive,
        coinsEarnedThisGame
    } = opts;

    // ---------- БАЛИ (без змін, для рейтингу) ----------
    const timeBonus = Math.round(
        Math.max(0, 1 - elapsed / timePerQuestion) * ECONOMY.timeBonusMax
    );
    const modeMult = MODES[mode] ? MODES[mode].multiplier : 1.0;

    let streakMultScore = 1.0;
    const scoreKeys = Object.keys(ECONOMY.streakScoreMultiplier).map(Number).sort((a, b) => b - a);
    for (const k of scoreKeys) {
        if (streak >= k) {
            streakMultScore = ECONOMY.streakScoreMultiplier[k];
            break;
        }
    }

    const powerMult = (powerActive && powerActive.type === 'double') ? 2 : 1;
    const gainedScore = Math.round(
        (ECONOMY.baseScore + timeBonus) * modeMult * streakMultScore * powerMult
    );

    // ---------- МОНЕТИ (жорстко обмежені) ----------
    let coins = ECONOMY.coinsCorrect; // +1 за правильну

    // +1 якщо відповідь прийшла дуже швидко (<25% часу)
    const speedRatio = elapsed / timePerQuestion;
    let speedBonus = 0;
    if (speedRatio <= 0.25) {
        speedBonus = ECONOMY.coinsSpeedBonus;
        coins += speedBonus;
    }

    // Стеля за гру
    const cap = ECONOMY.coinsPerGameCap;
    const alreadyEarned = coinsEarnedThisGame || 0;
    const remaining = Math.max(0, cap - alreadyEarned);
    if (coins > remaining) coins = remaining;

    const gainedXp = Math.round(gainedScore / 10);

    return {
        score: gainedScore,
        coins: coins,
        xp: gainedXp,
        breakdown: {
            timeBonus,
            modeMult,
            streakMultScore,
            speedBonus,
            powerMult,
            cap,
            alreadyEarned,
            remaining
        }
    };
}
