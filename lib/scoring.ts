import type {
  EducationAnalysis,
  ProjectScaleSignals,
  RecencyAnalysis,
  RedFlagAnalysis,
  RelevantExperienceResult,
  SeniorityResult,
  SkillDepthResult,
} from "@/lib/features";

export type ScoringWeights = {
  mustHaveSkills: number;
  niceToHaveSkills: number;
  experience: number;
  skillDepth?: number;
  seniority?: number;
  recency?: number;
  projectScale?: number;
  education?: number;
};

export type HardFilters = {
  minMustHaveMatchRatio?: number;
  requireAllMustHaveSkills?: boolean;
  minRelevantExperienceYears?: number;
  maxRedFlagPenalty?: number;
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
  relevantExperienceScore: number; // 0..1
  skillDepthScore: number; // 0..1
  seniorityScore: number; // 0..1
  recencyScore: number; // 0..1
  projectScaleScore: number; // 0..1
  educationScore: number; // 0..1
  redFlagPenalty: number; // 0..25 points
};

export type ScoreResult = {
  overallScore: number; // 0..100 (integer)
  rawScore: number; // before red flag penalty
  belowThreshold: boolean;
  thresholdReasons: string[];
  breakdown: ScoreBreakdown;
  effectiveWeights: ScoringWeights;
};

export type ScoreInputs = {
  minYearsExperience: number;
  hardFilters?: HardFilters;
  mustHave: SkillMatch[];
  niceToHave: SkillMatch[];
  candidateYearsExperience: number | null;
  relevantExperience: RelevantExperienceResult;
  skillDepth: SkillDepthResult[];
  seniority: SeniorityResult;
  recencyAnalysis: RecencyAnalysis;
  redFlags: RedFlagAnalysis;
  projectScale: ProjectScaleSignals;
  education: EducationAnalysis;
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
    skillDepth: safeNumber(weights.skillDepth, 0),
    seniority: safeNumber(weights.seniority, 0),
    recency: safeNumber(weights.recency, 0),
    projectScale: safeNumber(weights.projectScale, 0),
    education: safeNumber(weights.education, 0),
  };

  const sum =
    w.mustHaveSkills +
    w.niceToHaveSkills +
    w.experience +
    w.skillDepth +
    w.seniority +
    w.recency +
    w.projectScale +
    w.education;

  if (sum <= 0) {
    // Default weights for senior roles
    return {
      mustHaveSkills: 0.30,
      niceToHaveSkills: 0.10,
      experience: 0.20,
      skillDepth: 0.10,
      seniority: 0.10,
      recency: 0.08,
      projectScale: 0.08,
      education: 0.04,
    };
  }

  return {
    mustHaveSkills: w.mustHaveSkills / sum,
    niceToHaveSkills: w.niceToHaveSkills / sum,
    experience: w.experience / sum,
    skillDepth: w.skillDepth / sum,
    seniority: w.seniority / sum,
    recency: w.recency / sum,
    projectScale: w.projectScale / sum,
    education: w.education / sum,
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
  if (candidateYears === null || !Number.isFinite(candidateYears)) return 0;

  const ratio = candidateYears / minYears;

  if (ratio >= 1.5) return 1.0;
  if (ratio >= 1.0) return 0.8 + (ratio - 1.0) * 0.4;
  if (ratio >= 0.6) return 0.4 + (ratio - 0.6) * 1.0;
  return ratio * 0.67;
}

export function scoreRelevantExperience(
  relevantExp: RelevantExperienceResult,
  minYearsExperience: number,
): number {
  const relevantYears = relevantExp.relevantYears;
  if (relevantYears === null) {
    return scoreExperience(relevantExp.totalYears, minYearsExperience);
  }

  const baseScore = scoreExperience(relevantYears, minYearsExperience);

  const hasCurrentRelevant = relevantExp.roles.some(
    (r) => r.isRelevant && r.recency === "current",
  );
  const hasRecentRelevant = relevantExp.roles.some(
    (r) => r.isRelevant && r.recency === "recent",
  );

  let bonus = 0;
  if (hasCurrentRelevant) bonus += 0.1;
  else if (hasRecentRelevant) bonus += 0.05;

  return clamp01(baseScore + bonus);
}

export function scoreSkillDepth(skillDepthResults: SkillDepthResult[]): number {
  if (skillDepthResults.length === 0) return 0.5;

  const totalDepth = skillDepthResults.reduce((sum, s) => sum + s.depthScore, 0);
  const avgDepth = totalDepth / skillDepthResults.length;

  const highQualityCount = skillDepthResults.filter((s) => s.contextQuality === "high").length;
  const highQualityRatio = highQualityCount / skillDepthResults.length;

  return clamp01(avgDepth * 0.7 + highQualityRatio * 0.3);
}

export function scoreSeniority(
  seniority: SeniorityResult,
  minYearsExperience: number,
): number {
  const isSeniorRole = minYearsExperience >= 5;
  const isMidRole = minYearsExperience >= 3 && minYearsExperience < 5;

  if (isSeniorRole) {
    switch (seniority.level) {
      case "senior":
        return 0.9 + seniority.confidence * 0.1;
      case "mid":
        return 0.5 + seniority.confidence * 0.2;
      case "junior":
        return 0.2 - seniority.confidence * 0.1;
      default:
        return 0.4;
    }
  }

  if (isMidRole) {
    switch (seniority.level) {
      case "senior":
        return 0.85;
      case "mid":
        return 0.8 + seniority.confidence * 0.2;
      case "junior":
        return 0.4 - seniority.confidence * 0.1;
      default:
        return 0.5;
    }
  }

  switch (seniority.level) {
    case "senior":
      return 0.6;
    case "mid":
      return 0.8;
    case "junior":
      return 0.9;
    default:
      return 0.5;
  }
}

export function scoreRecency(recencyAnalysis: RecencyAnalysis): number {
  // Base score from recency analysis
  let score = recencyAnalysis.recencyScore;

  // Adjust based on career trajectory
  switch (recencyAnalysis.careerTrajectory.trajectory) {
    case "ascending":
      score += 0.1;
      break;
    case "descending":
      score -= 0.15;
      break;
    case "stable":
      // No adjustment
      break;
    case "unclear":
      score -= 0.05;
      break;
  }

  // Adjust based on how many skills are current vs stale
  const currentSkills = recencyAnalysis.skillRecency.filter(
    (s) => s.recencyCategory === "current" || s.recencyCategory === "recent",
  ).length;
  const totalSkills = recencyAnalysis.skillRecency.length;

  if (totalSkills > 0) {
    const currentRatio = currentSkills / totalSkills;
    score = score * 0.7 + currentRatio * 0.3;
  }

  return clamp01(score);
}

export function scoreProjectScale(projectScale: ProjectScaleSignals): number {
  return projectScale.scaleScore;
}

export function scoreEducation(
  education: EducationAnalysis,
  minYearsExperience: number,
): number {
  // For senior roles (5+ years), education matters less
  // Experience and demonstrated skills matter more
  if (minYearsExperience >= 5) {
    // Compress education score range for senior roles
    // Even bootcamp grads can be excellent senior devs
    return 0.5 + education.educationScore * 0.3;
  }

  // For mid-level roles
  if (minYearsExperience >= 3) {
    return 0.4 + education.educationScore * 0.4;
  }

  // For junior roles, education matters more
  return 0.3 + education.educationScore * 0.5;
}

export function scoreCandidate(inputs: ScoreInputs): ScoreResult {
  const weights = normalizeWeights(inputs.weights);
  const thresholdReasons: string[] = [];

  // Calculate all component scores
  const mustHaveSkillsScore = scoreSkills(inputs.mustHave);
  const niceToHaveSkillsScore = scoreSkills(inputs.niceToHave);

  const relevantExperienceScore = scoreRelevantExperience(
    inputs.relevantExperience,
    inputs.minYearsExperience,
  );

  const experienceScore = scoreExperience(
    inputs.candidateYearsExperience,
    inputs.minYearsExperience,
  );

  const skillDepthScore = scoreSkillDepth(inputs.skillDepth);
  const seniorityScore = scoreSeniority(inputs.seniority, inputs.minYearsExperience);
  const recencyScore = scoreRecency(inputs.recencyAnalysis);
  const projectScaleScore = scoreProjectScale(inputs.projectScale);
  const educationScore = scoreEducation(inputs.education, inputs.minYearsExperience);

  // Red flag penalty (0-25 points)
  const redFlagPenalty = inputs.redFlags.totalPenalty;

  const breakdown: ScoreBreakdown = {
    mustHaveSkillsScore,
    niceToHaveSkillsScore,
    experienceScore,
    relevantExperienceScore,
    skillDepthScore,
    seniorityScore,
    recencyScore,
    projectScaleScore,
    educationScore,
    redFlagPenalty,
  };

  // Calculate weighted score
  const overall01 =
    mustHaveSkillsScore * (weights.mustHaveSkills ?? 0) +
    niceToHaveSkillsScore * (weights.niceToHaveSkills ?? 0) +
    relevantExperienceScore * (weights.experience ?? 0) +
    skillDepthScore * (weights.skillDepth ?? 0) +
    seniorityScore * (weights.seniority ?? 0) +
    recencyScore * (weights.recency ?? 0) +
    projectScaleScore * (weights.projectScale ?? 0) +
    educationScore * (weights.education ?? 0);

  const rawScore = Math.round(clamp01(overall01) * 100);

  // Apply red flag penalty
  const finalScore = Math.max(0, rawScore - redFlagPenalty);

  // Check hard filters
  const minMustHaveMatchRatio = inputs.hardFilters?.minMustHaveMatchRatio;
  const requireAll = inputs.hardFilters?.requireAllMustHaveSkills;
  const minRelevantExp = inputs.hardFilters?.minRelevantExperienceYears;
  const maxRedFlagPenalty = inputs.hardFilters?.maxRedFlagPenalty;

  let belowThreshold = false;

  // Check must-have skills threshold
  if (typeof minMustHaveMatchRatio === "number" && mustHaveSkillsScore < minMustHaveMatchRatio) {
    belowThreshold = true;
    const pct = Math.round(mustHaveSkillsScore * 100);
    const required = Math.round(minMustHaveMatchRatio * 100);
    thresholdReasons.push(`Must-have skills ${pct}% < ${required}% required`);
  }

  // Check if all must-have skills are required
  if (requireAll === true) {
    const missing = inputs.mustHave.filter((s) => !s.matched);
    if (missing.length > 0) {
      belowThreshold = true;
      thresholdReasons.push(`Missing required skills: ${missing.map((s) => s.skill).join(", ")}`);
    }
  }

  // Check minimum relevant experience
  if (typeof minRelevantExp === "number") {
    const relevantYears = inputs.relevantExperience.relevantYears ?? 0;
    if (relevantYears < minRelevantExp) {
      belowThreshold = true;
      thresholdReasons.push(`Relevant experience ${relevantYears}y < ${minRelevantExp}y required`);
    }
  }

  // Check red flag penalty threshold
  if (typeof maxRedFlagPenalty === "number" && redFlagPenalty > maxRedFlagPenalty) {
    belowThreshold = true;
    thresholdReasons.push(`Red flag penalty ${redFlagPenalty} > ${maxRedFlagPenalty} max allowed`);
  }

  // Check if candidate is too junior for senior role
  if (
    inputs.minYearsExperience >= 5 &&
    inputs.seniority.level === "junior" &&
    inputs.seniority.confidence > 0.6
  ) {
    belowThreshold = true;
    thresholdReasons.push("Junior-level candidate for senior role");
  }

  // High severity red flags can trigger threshold
  const highSeverityFlags = inputs.redFlags.flags.filter((f) => f.severity === "high");
  if (highSeverityFlags.length >= 2) {
    belowThreshold = true;
    thresholdReasons.push(`Multiple high-severity red flags: ${highSeverityFlags.map((f) => f.type).join(", ")}`);
  }

  return {
    overallScore: finalScore,
    rawScore,
    belowThreshold,
    thresholdReasons,
    breakdown,
    effectiveWeights: weights,
  };
}
