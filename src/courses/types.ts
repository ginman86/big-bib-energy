/** What the course picker needs without loading the full course. */
export interface CourseMeta {
  id: string;
  name: string;
  place: string;
  kind: 'loop' | 'out-and-back';
  lapMeters: number;
  climbMeters: number;
  /** Steepest 50 m. */
  maxGrade: number;
  /** Average elevation above sea level: thinner air up high. */
  altitudeM: number;
  terrain: 'Flat' | 'Rolling' | 'Hilly';
  /** Elevations at evenly spaced points along the lap, for a small profile. */
  preview: number[];
  /** Imported from a GPX by the rider (vs built in). */
  custom?: boolean;
}
