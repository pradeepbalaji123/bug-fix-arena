CREATE TABLE public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE DEFAULT auth.uid(),
  display_name text,
  default_max_rounds int NOT NULL DEFAULT 3,
  default_timeout_ms int NOT NULL DEFAULT 3000,
  default_baseline boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own profiles" ON public.profiles FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  title text NOT NULL,
  code text NOT NULL,
  bug_report text NOT NULL,
  entry_function text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','needs_input','completed','partial','failed','cancelled','paused')),
  phase text,
  error text,
  current_round int NOT NULL DEFAULT 0,
  max_rounds int NOT NULL DEFAULT 3,
  timeout_ms int NOT NULL DEFAULT 3000,
  baseline_enabled boolean NOT NULL DEFAULT false,
  patchers jsonb NOT NULL DEFAULT '["patcher_a","patcher_b"]'::jsonb,
  triage jsonb,
  reference_implementation text,
  reproducer_retries int NOT NULL DEFAULT 0,
  winner_candidate_id uuid,
  best_score numeric,
  verdict_markdown text,
  share_token text UNIQUE,
  total_tokens int NOT NULL DEFAULT 0,
  duration_ms int NOT NULL DEFAULT 0,
  reputation_applied boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.runs TO authenticated;
GRANT ALL ON public.runs TO service_role;
ALTER TABLE public.runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own runs" ON public.runs FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX runs_user_idx ON public.runs(user_id, created_at DESC);

CREATE TABLE public.agent_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  round int NOT NULL DEFAULT 1,
  agent text NOT NULL CHECK (agent IN ('triager','reproducer','patcher_a','patcher_b','adversary','reviewer','arbiter','baseline')),
  label text,
  status text NOT NULL DEFAULT 'queued',
  input jsonb,
  output jsonb,
  model text,
  gateway_run_id text,
  prompt_tokens int,
  completion_tokens int,
  latency_ms int,
  attempts int NOT NULL DEFAULT 1,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.agent_steps TO authenticated;
GRANT ALL ON public.agent_steps TO service_role;
ALTER TABLE public.agent_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own steps" ON public.agent_steps FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE INDEX steps_run_idx ON public.agent_steps(run_id, created_at);

CREATE TABLE public.candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  round int NOT NULL DEFAULT 1,
  agent text NOT NULL,
  code text NOT NULL,
  explanation text,
  changed_lines int NOT NULL DEFAULT 0,
  reviewer jsonb,
  scores jsonb,
  final_score numeric,
  disqualified boolean NOT NULL DEFAULT false,
  disqualify_reason text,
  is_winner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.candidates TO authenticated;
GRANT ALL ON public.candidates TO service_role;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own candidates" ON public.candidates FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  round_created int NOT NULL DEFAULT 1,
  source text NOT NULL CHECK (source IN ('reproducer','adversary')),
  target_candidate_id uuid,
  name text NOT NULL,
  body text NOT NULL,
  rationale text,
  valid_on_reference boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tests TO authenticated;
GRANT ALL ON public.tests TO service_role;
ALTER TABLE public.tests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own tests" ON public.tests FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.test_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  run_id uuid NOT NULL REFERENCES public.runs(id) ON DELETE CASCADE,
  test_id uuid NOT NULL REFERENCES public.tests(id) ON DELETE CASCADE,
  candidate_id uuid,
  target text NOT NULL DEFAULT 'candidate',
  status text NOT NULL,
  message text,
  console jsonb,
  duration_ms numeric,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.test_results TO authenticated;
GRANT ALL ON public.test_results TO service_role;
ALTER TABLE public.test_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own results" ON public.test_results FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.reputation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  agent text NOT NULL,
  value numeric NOT NULL DEFAULT 1.0,
  wins int NOT NULL DEFAULT 0,
  losses int NOT NULL DEFAULT 0,
  attacks_landed int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, agent)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reputation TO authenticated;
GRANT ALL ON public.reputation TO service_role;
ALTER TABLE public.reputation ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own reputation" ON public.reputation FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.reputation_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  agent text NOT NULL,
  run_id uuid REFERENCES public.runs(id) ON DELETE SET NULL,
  delta numeric NOT NULL,
  reason text NOT NULL,
  value_after numeric NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.reputation_history TO authenticated;
GRANT ALL ON public.reputation_history TO service_role;
ALTER TABLE public.reputation_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "own rep history" ON public.reputation_history FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE public.demos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  difficulty text NOT NULL,
  code text NOT NULL,
  bug_report text NOT NULL,
  entry_function text NOT NULL,
  sort int NOT NULL DEFAULT 0
);
GRANT SELECT ON public.demos TO anon, authenticated;
GRANT ALL ON public.demos TO service_role;
ALTER TABLE public.demos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "demos public" ON public.demos FOR SELECT TO anon, authenticated USING (true);

CREATE OR REPLACE FUNCTION public.get_shared_run(_token text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
    'run', to_jsonb(r) - 'user_id' - 'share_token',
    'steps', COALESCE((SELECT jsonb_agg(to_jsonb(s) - 'user_id' - 'input' ORDER BY s.created_at) FROM agent_steps s WHERE s.run_id = r.id), '[]'::jsonb),
    'candidates', COALESCE((SELECT jsonb_agg(to_jsonb(c) - 'user_id' ORDER BY c.created_at) FROM candidates c WHERE c.run_id = r.id), '[]'::jsonb),
    'tests', COALESCE((SELECT jsonb_agg(to_jsonb(t) - 'user_id' ORDER BY t.created_at) FROM tests t WHERE t.run_id = r.id), '[]'::jsonb),
    'results', COALESCE((SELECT jsonb_agg(to_jsonb(x) - 'user_id') FROM test_results x WHERE x.run_id = r.id), '[]'::jsonb)
  ) END
  FROM (SELECT * FROM runs WHERE share_token = _token AND length(_token) >= 16 LIMIT 1) r;
$$;
GRANT EXECUTE ON FUNCTION public.get_shared_run(text) TO anon, authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.runs;
ALTER PUBLICATION supabase_realtime ADD TABLE public.agent_steps;
ALTER PUBLICATION supabase_realtime ADD TABLE public.candidates;

INSERT INTO public.demos (slug,title,description,difficulty,entry_function,sort,code,bug_report) VALUES
('binary-search','Binary Search Edge Miss','Classic off-by-one in the loop condition makes the search miss elements at the array edges.','Easy','binarySearch',1,
$c$function binarySearch(arr, target) {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (arr[mid] === target) return mid;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
$c$,
$c$binarySearch(sortedArray, target) should return the index of target in a sorted ascending array of numbers, or -1 if it is not present. It fails to find elements at the edges: binarySearch([1, 2, 3], 3) returns -1 instead of 2, and binarySearch([5], 5) returns -1 instead of 0.$c$),
('chunk-array','Chunk Array Drops Tail','Splitting an array into chunks silently drops the final partial chunk.','Easy','chunkArray',2,
$c$function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i + size <= arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
$c$,
$c$chunkArray(arr, size) should split arr into consecutive chunks of length size, with the last chunk containing the remaining elements. chunkArray([1, 2, 3, 4, 5], 2) returns [[1, 2], [3, 4]] but should return [[1, 2], [3, 4], [5]]. Input array must not be mutated; size is a positive integer.$c$),
('group-by','GroupBy Shared State Leak','Results from one call leak into the next because of a module-level accumulator.','Medium','groupBy',3,
$c$const groups = {};

function groupBy(arr, keyFn) {
  for (const item of arr) {
    const key = keyFn(item);
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }
  return groups;
}
$c$,
$c$groupBy(arr, keyFn) should return a new plain object mapping each key (the result of keyFn(item)) to an array of items with that key, in input order. Calling it twice leaks results: after groupBy([1, 2, 3], x => x % 2), calling groupBy([4], x => x % 2) returns { 0: [2, 4], 1: [1, 3] } instead of { 0: [4] }. An empty array should return {}.$c$),
('merge-intervals','Merge Intervals','Overlapping interval merge forgets to sort and does not merge touching intervals.','Medium','mergeIntervals',4,
$c$function mergeIntervals(intervals) {
  const result = [];
  for (const [start, end] of intervals) {
    const last = result[result.length - 1];
    if (last && start < last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      result.push([start, end]);
    }
  }
  return result;
}
$c$,
$c$mergeIntervals(intervals) takes an array of [start, end] pairs (start <= end, integers) in any order and should return the merged non-overlapping intervals sorted by start. Touching intervals like [1, 2] and [2, 3] must merge into [1, 3]. Currently mergeIntervals([[3, 4], [1, 2]]) is unsorted and mergeIntervals([[1, 2], [2, 3]]) returns [[1, 2], [2, 3]] instead of [[1, 3]]. Should not mutate the input; empty input returns [].$c$),
('parse-price','Parse Price Strings','Price parser mangles thousands separators and loses the sign of negative amounts.','Medium','parsePrice',5,
$c$function parsePrice(str) {
  const cleaned = str.replace('$', '').replace(',', '.');
  const value = parseFloat(cleaned);
  return Math.abs(value);
}
$c$,
$c$parsePrice(str) parses US-formatted price strings into a number. Commas are thousands separators and the dot is the decimal point. Optional leading "-" (before or after the "$") means negative. Examples: parsePrice("$1,234.56") should be 1234.56 (currently 1.234), parsePrice("-$5.00") should be -5 (currently 5), parsePrice("$1,000,000") should be 1000000, parsePrice("42") should be 42. Surrounding whitespace should be ignored. Invalid strings return NaN.$c$),
('lru-cache','LRU Cache Eviction','The cache never refreshes recency on get and evicts the most recent key instead of the least recent.','Hard','createLRUCache',6,
$c$class LRUCache {
  constructor(capacity) {
    this.capacity = capacity;
    this.map = new Map();
  }

  get(key) {
    return this.map.has(key) ? this.map.get(key) : -1;
  }

  put(key, value) {
    if (this.map.has(key)) {
      this.map.set(key, value);
      return;
    }
    if (this.map.size >= this.capacity) {
      const lastKey = Array.from(this.map.keys()).pop();
      this.map.delete(lastKey);
    }
    this.map.set(key, value);
  }
}

function createLRUCache(capacity) {
  return new LRUCache(capacity);
}
$c$,
$c$createLRUCache(capacity) returns a cache with get(key) and put(key, value). get returns the value or -1 if missing, and counts as a use. put inserts or updates a key (an update also counts as a use). When inserting a new key at capacity, the least-recently-used key must be evicted. Bug: with capacity 2, put(1,1), put(2,2), get(1), put(3,3) should evict key 2, but the cache evicts key 2 only by accident in some orders and in general evicts the most recently inserted key; get never refreshes recency. E.g. put(1,1), put(2,2), put(3,3) then get(1) should be -1 and get(2) should be 2, but get(2) returns -1.$c$);