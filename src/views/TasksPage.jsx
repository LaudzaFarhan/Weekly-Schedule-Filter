import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useSchedule } from '../contexts/ScheduleContext';
import { 
  createTask, 
  updateTask, 
  deleteTask,
  listenToMyTasks, 
  listenToDelegatedTasks, 
  listenToAllTasks 
} from '../services/taskService';
import { Plus, X, Search, Trash2 } from 'lucide-react';
import Badge from '../components/ui/Badge';
import { useToast } from '../components/ui/Toast';

export default function TasksPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const { uniqueBaseTeachers, disabledInstructors, instructorProfiles } = useSchedule();
  
  const [activeTab, setActiveTab] = useState('my_tasks'); // my_tasks, delegated, master
  const [tasks, setTasks] = useState([]);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    assignee: '',
    priority: 'medium',
    dueDate: ''
  });

  // Determine the logged in user's instructor name
  const myProfile = instructorProfiles?.find(p => 
    p.id === user?.email || 
    p.linkedEmail === user?.email || 
    (p.nickname && p.nickname.toLowerCase() === user?.email?.split('@')[0].toLowerCase())
  );
  const myTeacherName = myProfile?.fullname || myProfile?.nickname || user?.email?.split('@')[0] || 'Unknown';

  // Fetch tasks based on active tab
  useEffect(() => {
    if (!user) return;
    
    let unsubscribe;
    const email = user.email || 'unknown';
    
    if (activeTab === 'my_tasks') {
      unsubscribe = listenToMyTasks(myTeacherName, (data) => setTasks(data));
    } else if (activeTab === 'delegated') {
      unsubscribe = listenToDelegatedTasks(email, (data) => setTasks(data));
    } else if (activeTab === 'master') {
      unsubscribe = listenToAllTasks((data) => setTasks(data));
    }

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [user, activeTab, myTeacherName]);

  const handleDragStart = (e, taskId) => {
    e.dataTransfer.setData('taskId', taskId);
  };

  const handleDragOver = (e) => {
    e.preventDefault(); // necessary to allow dropping
  };

  const handleDrop = async (e, newStatus) => {
    const taskId = e.dataTransfer.getData('taskId');
    if (!taskId) return;
    
    // Optimistic update
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: newStatus } : t));
    
    try {
      await updateTask(taskId, { status: newStatus });
    } catch (err) {
      console.error(err);
      showToast({ title: 'Error moving task', variant: 'error' });
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!confirm('Are you sure you want to delete this task?')) return;
    try {
      await deleteTask(taskId);
      showToast({ title: 'Task deleted successfully', variant: 'success' });
    } catch (err) {
      console.error(err);
      showToast({ title: 'Failed to delete task', variant: 'error' });
    }
  };

  const submitNewTask = async (e) => {
    e.preventDefault();
    try {
      await createTask({
        ...newTask,
        assigner: user.email || 'Admin',
        status: 'pending'
      });
      
      // Trigger animation instead of closing immediately
      setIsAnimating(true);
      setTimeout(() => {
        setIsAnimating(false);
        setIsModalOpen(false);
        setNewTask({ title: '', description: '', assignee: '', priority: 'medium', dueDate: '' });
      }, 2500);

      showToast({ title: 'Task Assigned successfully', variant: 'success' });
    } catch (error) {
      console.error("Error creating task:", error);
      showToast({ title: 'Failed to assign task', variant: 'error' });
    }
  };

  // Group tasks by status
  const pendingTasks = tasks.filter(t => t.status === 'pending');
  const inProgressTasks = tasks.filter(t => t.status === 'in-progress');
  const completedTasks = tasks.filter(t => t.status === 'completed');

  const getPriorityColor = (p) => {
    if (p === 'high') return 'danger';
    if (p === 'medium') return 'warning';
    return 'success';
  };

  return (
    <section className="dashboard-view active">
      <div style={{ marginBottom: '1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ margin: '0 0 0.25rem 0' }}>To-Do List & Task Assignment</h2>
          <p className="subtext" style={{ margin: 0 }}>Manage personal tasks and delegated follow-ups</p>
        </div>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          <Plus size={18} /> Assign New Task
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.5rem' }}>
        <button 
          className={`btn ${activeTab === 'my_tasks' ? 'btn-primary' : 'btn-sm'}`} 
          onClick={() => setActiveTab('my_tasks')}
          style={{ background: activeTab !== 'my_tasks' ? 'transparent' : '', color: activeTab !== 'my_tasks' ? 'var(--text-primary)' : '' }}
        >
          My Tasks
        </button>
        <button 
          className={`btn ${activeTab === 'delegated' ? 'btn-primary' : 'btn-sm'}`} 
          onClick={() => setActiveTab('delegated')}
          style={{ background: activeTab !== 'delegated' ? 'transparent' : '', color: activeTab !== 'delegated' ? 'var(--text-primary)' : '' }}
        >
          Delegated by Me
        </button>
        <button 
          className={`btn ${activeTab === 'master' ? 'btn-primary' : 'btn-sm'}`} 
          onClick={() => setActiveTab('master')}
          style={{ background: activeTab !== 'master' ? 'transparent' : '', color: activeTab !== 'master' ? 'var(--text-primary)' : '' }}
        >
          Master View (All Tasks)
        </button>
      </div>

      {/* Kanban Board */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* PENDING COLUMN */}
        <div 
          style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px', minHeight: '400px' }}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, 'pending')}
        >
          <h3 style={{ margin: '0 0 1rem 0', display: 'flex', justifyContent: 'space-between' }}>
            Pending <Badge>{pendingTasks.length}</Badge>
          </h3>
          {pendingTasks.map(task => (
            <TaskCard key={task.id} task={task} onDragStart={handleDragStart} getPriorityColor={getPriorityColor} onDelete={() => handleDeleteTask(task.id)} />
          ))}
        </div>

        {/* IN PROGRESS COLUMN */}
        <div 
          style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px', minHeight: '400px' }}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, 'in-progress')}
        >
          <h3 style={{ margin: '0 0 1rem 0', display: 'flex', justifyContent: 'space-between' }}>
            In Progress <Badge variant="warning">{inProgressTasks.length}</Badge>
          </h3>
          {inProgressTasks.map(task => (
            <TaskCard key={task.id} task={task} onDragStart={handleDragStart} getPriorityColor={getPriorityColor} onDelete={() => handleDeleteTask(task.id)} />
          ))}
        </div>

        {/* COMPLETED COLUMN */}
        <div 
          style={{ background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '12px', minHeight: '400px' }}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, 'completed')}
        >
          <h3 style={{ margin: '0 0 1rem 0', display: 'flex', justifyContent: 'space-between' }}>
            Completed <Badge variant="success">{completedTasks.length}</Badge>
          </h3>
          {completedTasks.map(task => (
            <TaskCard key={task.id} task={task} onDragStart={handleDragStart} getPriorityColor={getPriorityColor} onDelete={() => handleDeleteTask(task.id)} />
          ))}
        </div>

      </div>

      {/* Create Task Modal */}
      {isModalOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999,
          backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
          <div style={{ background: 'white', padding: '2rem', borderRadius: '16px', width: '100%', maxWidth: '500px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ margin: 0 }}>Assign New Task</h2>
              <button onClick={() => setIsModalOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X /></button>
            </div>
            
            {isAnimating ? (
              <div style={{ 
                textAlign: 'center', 
                padding: '1.5rem', 
                overflow: 'hidden', 
                position: 'relative', 
                height: '240px',
                background: 'linear-gradient(135deg, rgba(239, 246, 255, 0.9), rgba(219, 234, 254, 0.9))',
                borderRadius: '16px',
                border: '1px solid rgba(191, 219, 254, 0.8)',
                boxShadow: 'inset 0 0 20px rgba(59, 130, 246, 0.05), 0 8px 32px 0 rgba(31, 38, 135, 0.05)',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                animation: 'container-fade 2.5s ease-in-out infinite'
              }}>
                <style>{`
                  @keyframes container-fade {
                    0% { opacity: 0; transform: scale(0.95); }
                    10% { opacity: 1; transform: scale(1); }
                    90% { opacity: 1; transform: scale(1); }
                    100% { opacity: 0; transform: scale(0.95); }
                  }
                  @keyframes body-throw {
                    0%, 100% { transform: translateX(0) rotate(0deg); }
                    24% { transform: translateX(-12px) rotate(-8deg); }
                    36% { transform: translateX(18px) rotate(12deg); }
                    56% { transform: translateX(8px) rotate(4deg); }
                    80% { transform: translateX(0) rotate(0deg); }
                  }
                  @keyframes arm-throw {
                    0%, 100% { transform: rotate(0deg) translate(0, 0); }
                    24% { transform: rotate(-75deg) translate(-5px, -5px); }
                    32% { transform: rotate(45deg) translate(5px, -2px); }
                    48% { transform: rotate(60deg) translate(8px, 0px); }
                    72% { transform: rotate(0deg) translate(0, 0); }
                  }
                  @keyframes card-fly {
                    0% { transform: translate(0, 0) scale(0.6) rotate(0deg); opacity: 0; }
                    24% { transform: translate(-10px, -15px) scale(0.8) rotate(-10deg); opacity: 1; }
                    25% { transform: translate(0px, -15px) scale(1) rotate(0deg); opacity: 1; }
                    48% { transform: translate(110px, -50px) scale(1.4) rotate(360deg); opacity: 1; }
                    60% { transform: translate(220px, 0px) scale(1) rotate(720deg); opacity: 1; }
                    64%, 100% { transform: translate(220px, 0px) scale(0) rotate(720deg); opacity: 0; }
                  }
                  @keyframes trail-sparkle {
                    0%, 24% { opacity: 0; transform: scale(0.5); }
                    25% { opacity: 0.8; transform: scale(1) translate(-10px, 10px); }
                    48% { opacity: 0.8; transform: scale(0.8) translate(-25px, 20px); }
                    60%, 100% { opacity: 0; transform: scale(0); }
                  }
                  @keyframes body-catch {
                    0%, 56% { transform: scale(1) translateY(0); }
                    64% { transform: scale(1.15) translateY(-8px) rotate(-5deg); }
                    72% { transform: scale(1.1) translateY(-4px) rotate(5deg); }
                    88%, 100% { transform: scale(1) translateY(0) rotate(0deg); }
                  }
                  @keyframes sparkle-glow {
                    0%, 58% { opacity: 0; transform: scale(0.5) translateY(0); }
                    62% { opacity: 1; transform: scale(1.2) translateY(-15px); }
                    70% { opacity: 1; transform: scale(1) translateY(-25px); }
                    80%, 100% { opacity: 0; transform: scale(0.8) translateY(-30px); }
                  }
                `}</style>
                <h3 style={{ margin: '0 0 10px 0', color: '#1e3a8a', fontSize: '1.1rem', fontWeight: 600, letterSpacing: '0.5px' }}>
                  Assigning Task to {newTask.assignee}...
                </h3>
                <div style={{ position: 'relative', width: '100%', height: '140px', marginTop: '10px' }}>
                  {/* Decorative Floor */}
                  <div style={{ 
                    position: 'absolute', 
                    bottom: '10px', 
                    left: '10%', 
                    right: '10%', 
                    height: '4px', 
                    background: 'linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.3), transparent)', 
                    borderRadius: '2px' 
                  }} />
                  
                  {/* Thrower */}
                  <div style={{ 
                    position: 'absolute', 
                    left: '15%', 
                    bottom: '15px', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center',
                    animation: 'body-throw 2.5s cubic-bezier(0.25, 0.8, 0.25, 1) infinite' 
                  }}>
                    <span style={{ fontSize: '0.7rem', color: '#1e40af', fontWeight: '500', marginBottom: '2px', opacity: 0.8 }}>Assigner</span>
                    <div style={{ position: 'relative', width: '50px', height: '50px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      <div style={{ fontSize: '3rem', zIndex: 2 }}>🥋</div>
                      {/* Separate Throwing Arm */}
                      <div style={{ 
                        position: 'absolute', 
                        right: '-12px', 
                        top: '12px', 
                        fontSize: '2rem', 
                        transformOrigin: 'left bottom',
                        zIndex: 3,
                        animation: 'arm-throw 2.5s cubic-bezier(0.25, 0.8, 0.25, 1) infinite'
                      }}>🫱</div>
                    </div>
                  </div>

                  {/* Flying Card */}
                  <div style={{ 
                    position: 'absolute', 
                    left: 'calc(15% + 35px)', 
                    bottom: '45px', 
                    fontSize: '2rem', 
                    zIndex: 4,
                    animation: 'card-fly 2.5s cubic-bezier(0.25, 0.8, 0.25, 1) infinite'
                  }}>
                    📋
                    <span style={{
                      position: 'absolute',
                      right: '-10px',
                      bottom: '-5px',
                      fontSize: '1rem',
                      animation: 'trail-sparkle 2.5s infinite'
                    }}>✨</span>
                  </div>

                  {/* Receiver */}
                  <div style={{ 
                    position: 'absolute', 
                    right: '15%', 
                    bottom: '15px', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center',
                    animation: 'body-catch 2.5s cubic-bezier(0.25, 0.8, 0.25, 1) infinite'
                  }}>
                    <span style={{ fontSize: '0.7rem', color: '#1e40af', fontWeight: '500', marginBottom: '2px', opacity: 0.8 }}>
                      {newTask.assignee || 'Assignee'}
                    </span>
                    <div style={{ position: 'relative', width: '50px', height: '50px', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                      <div style={{ fontSize: '3rem', zIndex: 2 }}>🧍</div>
                      {/* Sparks on Catch */}
                      <div style={{
                        position: 'absolute',
                        top: '-10px',
                        fontSize: '1.5rem',
                        opacity: 0,
                        animation: 'sparkle-glow 2.5s infinite'
                      }}>✨</div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <form onSubmit={submitNewTask} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div className="input-group">
                  <label>Title</label>
                  <input required type="text" value={newTask.title} onChange={e => setNewTask({...newTask, title: e.target.value})} placeholder="e.g. Call parent of Ebenezer" />
                </div>
                
                <div className="input-group">
                  <label>Description</label>
                  <textarea rows="3" value={newTask.description} onChange={e => setNewTask({...newTask, description: e.target.value})} placeholder="Detailed instructions..." />
                </div>

                <div className="input-group">
                  <label>Assignee</label>
                  <select required value={newTask.assignee} onChange={e => setNewTask({...newTask, assignee: e.target.value})}>
                    <option value="" disabled>Select an Instructor...</option>
                    {[...uniqueBaseTeachers].filter(t => !disabledInstructors?.has(t)).map(t => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>

                <div style={{ display: 'flex', gap: '1rem' }}>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Priority</label>
                    <select value={newTask.priority} onChange={e => setNewTask({...newTask, priority: e.target.value})}>
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                    </select>
                  </div>
                  <div className="input-group" style={{ flex: 1 }}>
                    <label>Due Date</label>
                    <input type="date" required value={newTask.dueDate} onChange={e => setNewTask({...newTask, dueDate: e.target.value})} />
                  </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1rem' }}>
                  <button type="button" className="btn btn-sm" onClick={() => setIsModalOpen(false)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Create Task</button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

    </section>
  );
}

function TaskCard({ task, onDragStart, getPriorityColor, onDelete }) {
  return (
    <div 
      draggable
      onDragStart={(e) => onDragStart(e, task.id)}
      style={{
        background: 'white',
        padding: '1rem',
        borderRadius: '8px',
        marginBottom: '1rem',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
        cursor: 'grab',
        borderLeft: `4px solid var(--${getPriorityColor(task.priority)})`
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
        <Badge variant={getPriorityColor(task.priority)}>{task.priority}</Badge>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{task.dueDate}</span>
          <button 
            onClick={(e) => { e.stopPropagation(); onDelete(); }} 
            style={{ 
              background: 'none', border: 'none', cursor: 'pointer', 
              color: 'var(--danger)', opacity: 0.6, padding: '2px', display: 'flex', alignItems: 'center' 
            }}
            title="Delete task"
            onMouseOver={(e) => e.currentTarget.style.opacity = 1}
            onMouseOut={(e) => e.currentTarget.style.opacity = 0.6}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <h4 style={{ margin: '0 0 0.5rem 0' }}>{task.title}</h4>
      <p style={{ margin: '0 0 1rem 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{task.description}</p>
      
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)', paddingTop: '0.5rem' }}>
        <span><strong>For:</strong> {task.assignee}</span>
        <span><strong>From:</strong> {task.assigner.split('@')[0]}</span>
      </div>
    </div>
  );
}
