export type ScoringWeights = {
  mustHaveSkills: number;
  niceToHaveSkills: number;
  experience: number;
};

export type HardFilters = {
  minMustHaveMatchRatio?: number;
  requireAllMustHaveSkills?: boolean;
};

export type SkillMatch = {
  skill: string;
  weight: number;
  matched: boolean;
  evidence: string[];
};

export type KeywordHit = {
  keyword: string;
  matched: boolean;
  evidence: string[];
};

export type ScoreBreakdown = {
  mustHaveSkillsScore: number; // 0..1
  niceToHaveSkillsScore: number; // 0..1
  experienceScore: number; // 0..1
};

export type ScoreResult = {
  overallScore: number; // 0..100 (integer)
  belowThreshold: boolean;
  breakdown: ScoreBreakdown;
  effectiveWeights: ScoringWeights;
};

export type ScoreInputs = {
  minYearsExperience: number;
  hardFilters?: HardFilters;
  mustHave: SkillMatch[];
  niceToHave: SkillMatch[];
  candidateYearsExperience: number | null;
  weights: ScoringWeights;
};

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function safeNumber(n: unknown, fallback = 0): number {
  return typeof n === "number" && Number.isFinite(n) ? n : fallback;
}

export function normalizeWeights(weights: ScoringWeights): ScoringWeights {
  const w = {
    mustHaveSkills: safeNumber(weights.mustHaveSkills, 0),
    niceToHaveSkills: safeNumber(weights.niceToHaveSkills, 0),
    experience: safeNumber(weights.experience, 0),
  };
  const sum = w.mustHaveSkills + w.niceToHaveSkills + w.experience;
  if (sum <= 0) {
    return { mustHaveSkills: 0.7, niceToHaveSkills: 0.2, experience: 0.1 };
  }
  return {
    mustHaveSkills: w.mustHaveSkills / sum,
    niceToHaveSkills: w.niceToHaveSkills / sum,
    experience: w.experience / sum,
  };
}

export function scoreSkills(matches: SkillMatch[]): number {
  const total = matches.reduce((sum, s) => sum + safeNumber(s.weight, 0), 0);
  if (total <= 0) return 1;
  const matched = matches.reduce((sum, s) => sum + (s.matched ? safeNumber(s.weight, 0) : 0), 0);
  return clamp01(matched / total);
}

export function scoreExperience(candidateYears: number | null, minYearsExperience: number): number {
  const minYears = safeNumber(minYearsExperience, 0);
  if (minYears <= 0) return 1;
  // If we can't extract experience reliably, treat it as 0 (not 0.5) to avoid ambiguity.
  if (candidateYears === null || !Number.isFinite(candidateYears)) return 0;
  return clamp01(candidateYears / minYears);
}

export function scoreCandidate(inputs: ScoreInputs): ScoreResult {
  const weights = normalizeWeights(inputs.weights);

  const mustHaveSkillsScore = scoreSkills(inputs.mustHave);
  const niceToHaveSkillsScore = scoreSkills(inputs.niceToHave);
  const experienceScore = scoreExperience(inputs.candidateYearsExperience, inputs.minYearsExperience);

  const breakdown: ScoreBreakdown = {
    mustHaveSkillsScore,
    niceToHaveSkillsScore,
    experienceScore,
  };

  const overall01 =
    mustHaveSkillsScore * weights.mustHaveSkills +
    niceToHaveSkillsScore * weights.niceToHaveSkills +
    experienceScore * weights.experience;

  const minMustHaveMatchRatio = inputs.hardFilters?.minMustHaveMatchRatio;
  const requireAll = inputs.hardFilters?.requireAllMustHaveSkills;

  const belowThreshold =
    (typeof minMustHaveMatchRatio === "number" && mustHaveSkillsScore < minMustHaveMatchRatio) ||
    (requireAll === true && inputs.mustHave.some((s) => !s.matched));

  return {
    overallScore: Math.round(clamp01(overall01) * 100),
    belowThreshold,
    breakdown,
    effectiveWeights: weights,
  };
}


