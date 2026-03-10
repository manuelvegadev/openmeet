import type { Room } from '@openmeet/shared';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { LogIn, Plus, Video } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export const Route = createFileRoute('/')({
  component: HomePage,
});

function HomePage() {
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);

  async function handleCreate() {
    try {
      const res = await fetch('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Room' }),
      });
      if (res.ok) {
        const room: Room = await res.json();
        navigate({ to: '/room/$roomId', params: { roomId: room.id } });
      }
    } catch (err) {
      console.error('Failed to create room:', err);
    }
  }

  function handleJoin() {
    if (!joinCode.trim()) return;
    navigate({ to: '/room/$roomId', params: { roomId: joinCode.trim() } });
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-xs space-y-6">
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <Video className="h-8 w-8 text-primary" />
            <h1 className="text-3xl font-bold">OpenMeet</h1>
          </div>
          <p className="text-muted-foreground">Lightweight video conferencing</p>
        </div>

        <div className="space-y-3">
          <Button onClick={handleCreate} className="w-full h-12 text-base" size="lg">
            <Plus className="h-5 w-5 mr-2" />
            Create Room
          </Button>

          {showJoinInput ? (
            <div className="flex gap-2">
              <Input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="Room code"
                autoFocus
                onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              />
              <Button onClick={handleJoin} disabled={!joinCode.trim()}>
                <LogIn className="h-4 w-4" />
              </Button>
            </div>
          ) : (
            <Button
              onClick={() => setShowJoinInput(true)}
              variant="outline"
              className="w-full h-12 text-base"
              size="lg"
            >
              <LogIn className="h-5 w-5 mr-2" />
              Join Room
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
