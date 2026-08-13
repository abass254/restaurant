<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('instagram_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('instagram_conversation_id')->constrained()->cascadeOnDelete();
            $table->string('instagram_message_id')->unique();
            $table->string('direction'); // inbound | outbound
            $table->string('sender_ig_id')->nullable();
            $table->string('sender_username')->nullable();
            $table->text('body')->nullable();
            $table->timestamp('sent_at')->nullable();
            $table->boolean('auto_replied')->default(false);
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('instagram_messages');
    }
};
