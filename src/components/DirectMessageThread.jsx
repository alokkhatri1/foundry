import { useState, useEffect, useRef } from 'react';

export default function DirectMessageThread({ myParticipantId, otherParticipant, sb, onBack }) {
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!myParticipantId || !otherParticipant?.id) return;
    let cancelled = false;
    sb.fetchDmThread(myParticipantId, otherParticipant.id).then(initial => {
      if (!cancelled) setMessages(initial);
    });
    const unsub = sb.subscribeToDms(myParticipantId, (dm) => {
      const belongs = (dm.from_participant_id === otherParticipant.id && dm.to_participant_id === myParticipantId)
                    || (dm.from_participant_id === myParticipantId && dm.to_participant_id === otherParticipant.id);
      if (belongs) {
        setMessages(prev => prev.some(m => m.id === dm.id) ? prev : [...prev, dm]);
      }
    });
    return () => { cancelled = true; unsub(); };
  }, [sb, myParticipantId, otherParticipant?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function handleSend() {
    const text = inputValue.trim();
    if (!text || sending) return;
    setError('');
    if (!myParticipantId) {
      setError('Still joining the workshop — please wait a moment and try again.');
      return;
    }
    if (!otherParticipant?.id) {
      setError('Cannot find this person in the workshop database.');
      return;
    }
    setSending(true);
    const result = await sb.sendDm(myParticipantId, otherParticipant.id, text);
    setSending(false);
    if (result) {
      setInputValue('');
      setMessages(prev => prev.some(m => m.id === result.id) ? prev : [...prev, result]);
    } else {
      setError('Send failed. Check the browser console for the specific error.');
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="dm-thread">
      <div className="dm-header">
        <button className="dm-back-btn" onClick={onBack} aria-label="Back">{'\u2190'}</button>
        <div className="dm-header-avatar" style={{ background: otherParticipant?.color || '#888' }}>
          {otherParticipant?.name?.charAt(0)?.toUpperCase() || '?'}
        </div>
        <span className="dm-header-name">{otherParticipant?.name || 'Direct message'}</span>
      </div>
      <div className="dm-messages">
        {messages.length === 0 ? (
          <div className="dm-empty">No messages yet. Send the first one.</div>
        ) : (
          messages.map(m => {
            const isMine = m.from_participant_id === myParticipantId;
            return (
              <div key={m.id} className={`dm-message${isMine ? ' mine' : ''}`}>
                <div className="dm-bubble">{m.content}</div>
                <div className="dm-time">{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>
      {error && (
        <div className="dm-error">{error}</div>
      )}
      <div className="dm-input-row">
        <textarea
          className="dm-input"
          value={inputValue}
          onChange={e => setInputValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={`Message ${otherParticipant?.name || '...'}`}
          rows={2}
        />
        <button className="dm-send-btn" onClick={handleSend} disabled={!inputValue.trim() || sending}>
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
