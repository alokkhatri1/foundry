import { useRef, useCallback, useEffect } from 'react';
import { supabase, isSupabaseConfigured } from '../supabase';

// Debounce writes to avoid hammering Supabase on every keystroke
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

export default function useSupabase() {
  const roomIdRef = useRef(null);
  const channelRef = useRef(null);
  const presenceChannelRef = useRef(null);

  // ===== Room: create or join =====
  const joinRoom = useCallback(async (code, orgName) => {
    console.log('[supabase] joinRoom called, configured:', isSupabaseConfigured);
    if (!isSupabaseConfigured) return null;

    // Upsert room
    const { data: room, error } = await supabase
      .from('rooms')
      .upsert({ code, org_name: orgName }, { onConflict: 'code' })
      .select('id')
      .single();

    if (error) { console.error('[supabase] joinRoom error:', error.message); return null; }
    roomIdRef.current = room.id;
    console.log('[supabase] joinRoom success, roomId:', room.id);
    return room.id;
  }, []);

  // ===== Participant: upsert on join =====
  const upsertParticipant = useCallback(async (name, color) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    await supabase.from('participants').upsert(
      { room_id: roomIdRef.current, name, color, online: true, last_seen_at: new Date().toISOString() },
      { onConflict: 'room_id,name' }
    );
  }, []);

  // ===== Room state: load =====
  const loadRoomState = useCallback(async () => {
    if (!isSupabaseConfigured || !roomIdRef.current) return null;
    const { data, error } = await supabase
      .from('room_state')
      .select('file_tree, coworkers, tools, workflows')
      .eq('room_id', roomIdRef.current)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 = no rows
      console.error('[supabase] loadRoomState:', error.message);
    }
    return data || null;
  }, []);

  // ===== Room state: save (debounced) =====
  const saveRoomStateImpl = useCallback(async (state) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    const { error } = await supabase.from('room_state').upsert({
      room_id: roomIdRef.current,
      file_tree: state.fileTree,
      coworkers: state.coworkers,
      tools: state.tools,
      workflows: state.workflows,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'room_id' });
    if (error) console.error('[supabase] saveRoomState:', error.message);
  }, []);

  const saveRoomState = useRef(debounce((state) => saveRoomStateImpl(state), 1000)).current;

  // ===== Messages: save =====
  const saveMessage = useCallback(async (msg, conversationId) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    // Don't persist loading or transient messages
    if (msg.type === 'loading') return;

    const row = {
      room_id: roomIdRef.current,
      conversation_id: conversationId || null,
      type: msg.type,
      participant_name: msg.participantName || null,
      content: msg.content || null,
      label: msg.label || null,
      coworker_avatar: msg.coworkerAvatar || null,
      tool_name: msg.toolName || null,
      tool_icon: msg.toolIcon || null,
      tool_type: msg.toolType || null,
      tool_inputs: msg.inputs || null,
      tool_outputs: msg.outputs || null,
      payload: msg.attachments ? { attachments: msg.attachments } : null,
    };
    const { error } = await supabase.from('messages').insert(row);
    if (error) console.error('[supabase] saveMessage:', error.message);
  }, []);

  // ===== Messages: load for room =====
  const loadMessages = useCallback(async () => {
    if (!isSupabaseConfigured || !roomIdRef.current) return [];
    const { data, error } = await supabase
      .from('messages')
      .select('*')
      .eq('room_id', roomIdRef.current)
      .order('created_at', { ascending: true })
      .limit(500);

    if (error) { console.error('[supabase] loadMessages:', error.message); return []; }

    // Convert DB rows back to app message format
    return (data || []).map(row => ({
      id: row.id,
      type: row.type,
      content: row.content,
      participantName: row.participant_name,
      label: row.label,
      coworkerAvatar: row.coworker_avatar,
      toolName: row.tool_name,
      toolIcon: row.tool_icon,
      toolType: row.tool_type,
      inputs: row.tool_inputs,
      outputs: row.tool_outputs,
      attachments: row.payload?.attachments || undefined,
      conversationId: row.conversation_id,
      timestamp: new Date(row.created_at).getTime(),
    }));
  }, []);

  // ===== Workflow runs: save =====
  const saveWorkflowRun = useCallback(async (run) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    const { error } = await supabase.from('workflow_runs').upsert({
      id: run.id,
      room_id: roomIdRef.current,
      workflow_id: run.workflowId,
      workflow_name: run.workflowName,
      status: run.status,
      current_step_index: run.currentStepIndex,
      started_by: run.startedBy,
      case_input: run.caseInput,
      step_results: run.stepResults,
      started_at: run.startedAt ? new Date(run.startedAt).toISOString() : new Date().toISOString(),
      completed_at: run.completedAt ? new Date(run.completedAt).toISOString() : null,
    }, { onConflict: 'id' });
    if (error) console.error('[supabase] saveWorkflowRun:', error.message);
  }, []);

  // ===== Tool calls: log =====
  const logToolCall = useCallback(async (data) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    await supabase.from('tool_calls').insert({
      room_id: roomIdRef.current,
      run_id: data.runId || null,
      coworker_id: data.coworkerId || null,
      coworker_name: data.coworkerName || null,
      tool_name: data.toolName,
      tool_type: data.toolType || null,
      inputs: data.inputs || null,
      outputs: data.outputs || null,
      success: data.outputs?.success ?? true,
    });
  }, []);

  // ===== Approvals: log =====
  const logApproval = useCallback(async (data) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return;
    await supabase.from('approvals').insert({
      room_id: roomIdRef.current,
      run_id: data.runId || null,
      step_id: data.stepId || null,
      step_name: data.stepName || null,
      prompt: data.prompt || null,
      assignee_name: data.assigneeName || null,
      resolved_by: data.resolvedBy || null,
      action: data.action,
      comment: data.comment || null,
      resolved_at: new Date().toISOString(),
    });
  }, []);

  // ===== Realtime: subscribe to room changes =====
  const subscribe = useCallback((onRoomStateChange, onNewMessage) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return () => {};

    const channel = supabase.channel(`room:${roomIdRef.current}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'room_state',
        filter: `room_id=eq.${roomIdRef.current}`,
      }, (payload) => {
        if (payload.new && onRoomStateChange) onRoomStateChange(payload.new);
      })
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `room_id=eq.${roomIdRef.current}`,
      }, (payload) => {
        if (payload.new && onNewMessage) {
          const row = payload.new;
          onNewMessage({
            id: row.id,
            type: row.type,
            content: row.content,
            participantName: row.participant_name,
            label: row.label,
            coworkerAvatar: row.coworker_avatar,
            toolName: row.tool_name,
            toolIcon: row.tool_icon,
            toolType: row.tool_type,
            inputs: row.tool_inputs,
            outputs: row.tool_outputs,
            conversationId: row.conversation_id,
            timestamp: new Date(row.created_at).getTime(),
          });
        }
      })
      .subscribe();

    channelRef.current = channel;
    return () => {
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, []);

  // ===== Presence: track who's online in the workshop =====
  const trackPresence = useCallback((userName, userColor, onPresenceChange) => {
    if (!isSupabaseConfigured || !roomIdRef.current) return () => {};

    // Clean up existing presence channel
    if (presenceChannelRef.current) {
      supabase.removeChannel(presenceChannelRef.current);
    }

    const channel = supabase.channel(`presence:${roomIdRef.current}`, {
      config: { presence: { key: userName } },
    });

    channel.on('presence', { event: 'sync' }, () => {
      const state = channel.presenceState();
      const online = [];
      for (const [key, entries] of Object.entries(state)) {
        if (entries.length > 0) {
          const entry = entries[0];
          online.push({
            name: entry.name || key,
            color: entry.color || null,
            online: true,
          });
        }
      }
      if (onPresenceChange) onPresenceChange(online);
    });

    channel.subscribe(async (status) => {
      if (status === 'SUBSCRIBED') {
        await channel.track({ name: userName, color: userColor });
      }
    });

    presenceChannelRef.current = channel;

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
      presenceChannelRef.current = null;
    };
  }, []);

  const leavePresence = useCallback(() => {
    if (presenceChannelRef.current) {
      presenceChannelRef.current.untrack();
      supabase.removeChannel(presenceChannelRef.current);
      presenceChannelRef.current = null;
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (presenceChannelRef.current) {
        presenceChannelRef.current.untrack();
        supabase.removeChannel(presenceChannelRef.current);
      }
    };
  }, []);

  return {
    isConfigured: isSupabaseConfigured,
    joinRoom,
    upsertParticipant,
    loadRoomState,
    saveRoomState,
    saveMessage,
    loadMessages,
    saveWorkflowRun,
    logToolCall,
    logApproval,
    subscribe,
    trackPresence,
    leavePresence,
  };
}
