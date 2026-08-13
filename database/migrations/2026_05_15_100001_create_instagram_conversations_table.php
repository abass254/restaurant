<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('instagram_conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('instagram_account_id')->constrained()->cascadeOnDelete();
            $table->string('instagram_conversation_id')->index();
            $table->string('participant_username')->nullable();
            $table->string('participant_ig_id')->nullable();
            $table->timestamp('last_message_at')->nullable();
            $table->timestamps();

            $table->unique(['instagram_account_id', 'instagram_conversation_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('instagram_conversations');
    }
};
