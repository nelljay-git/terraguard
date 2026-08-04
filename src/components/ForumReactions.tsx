import { Loader2, ThumbsUp, Lightbulb, Sparkles } from 'lucide-react';
import type { ForumReaction } from '../lib/forum';

const REACTIONS: { key: ForumReaction; label: string; icon: typeof ThumbsUp }[] = [
  { key: 'like', label: 'Like', icon: ThumbsUp },
  { key: 'helpful', label: 'Helpful', icon: Lightbulb },
  { key: 'interesting', label: 'Interesting', icon: Sparkles },
];

interface ForumReactionsProps {
  likeCount: number;
  helpfulCount: number;
  interestingCount: number;
  myReaction: ForumReaction | null;
  busy: ForumReaction | null;
  onReact: (reaction: ForumReaction) => void;
}

export function ForumReactions({
  likeCount,
  helpfulCount,
  interestingCount,
  myReaction,
  busy,
  onReact,
}: ForumReactionsProps) {
  const counts: Record<ForumReaction, number> = {
    like: likeCount,
    helpful: helpfulCount,
    interesting: interestingCount,
  };

  return (
    <div className="forum-reaction-group">
      {REACTIONS.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          type="button"
          className={`forum-react-btn reaction-${key} ${myReaction === key ? 'active' : ''}`}
          onClick={() => onReact(key)}
          disabled={busy === key}
          title={label}
        >
          {busy === key ? <Loader2 size={15} className="spin" /> : <Icon size={15} />}
          <span className="react-count">{counts[key]}</span>
        </button>
      ))}
    </div>
  );
}
